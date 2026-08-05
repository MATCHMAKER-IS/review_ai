import { NextResponse } from "next/server";
import {
  saveMessage,
  getPairIfComplete,
  saveJudgment,
  type MessageType,
} from "@/lib/store";
import { reviewPair } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * レビューAI 受信・判定口
 *
 * ══ POST 専用 ══════════════════════════
 *
 *   POST /api/review
 *   X-Api-Key: <HOOK_SECRET>
 *
 *   {
 *     "ticket_id": "1234567",   必須  問い合わせID
 *     "message":   "本文",       必須  メッセージ内容
 *     "type":      "ai",         必須  "ai" / "sent"
 *     "staff_id":  "890123",     任意  担当ユーザーのID
 *     "memory":    7             任意  メモリのバージョン番号
 *   }
 *
 * 【流れ】
 *   1. 受信メッセージを1行保存（review_messages）
 *   2. 同じ ticket_id に ai と sent が揃ったか確認
 *   3. 揃っていれば OpenAI で差異を判定
 *   4. 判定結果を保存（review_judgments）
 *
 *   ai を先に受けた段階（sent 未達）では 1 だけ行い、判定はしません。
 *
 * 【判定内でLLMを使う範囲】
 *   差分の有無・修正量・§7の切り分けは純粋な関数で計算します。
 *   OpenAI には「差分の要約と文体ルールの言語化」だけをさせます。
 *   OpenAI が失敗しても、機械的な判定結果は保存されます。
 *
 * 【レスポンス】
 *   成功: { "result": "success" }              HTTP 200
 *   失敗: { "result": "error", "code": "...", "message": "..." }
 *
 *   判定の中身（差分・切り分け・要約）は review_judgments に保存され、
 *   レスポンスには含めません。API は成功/失敗だけを返します。
 */

/**
 * 失敗レスポンス。形は常に { result: "error", ... }。
 *
 * message は原因調査用に残します（CloudWatch では追いにくいため、
 * Deluge のログにも理由が残るように）。判定に使うのは result だけで
 * 十分です。
 */
function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ result: "error", code, message }, { status });
}

const AI_ALIASES = ["ai", "draft", "0"];
const SENT_ALIASES = ["sent", "send", "1"];

function normalizeType(raw: unknown): MessageType | null {
  if (typeof raw === "number") return raw === 1 ? "sent" : "ai";
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (AI_ALIASES.includes(v)) return "ai";
  if (SENT_ALIASES.includes(v)) return "sent";
  return null;
}

function toInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

/**
 * message 用の正規化。
 *
 * Deluge 側は JSON エスケープが不安定なため、改行を <br> に置換して
 * 送ってくることがあります。ここで改行へ戻します。
 *   <br> <br/> <br /> （大文字小文字問わず）→ \n
 * 既に生の改行が含まれていればそのまま残します。
 */
function restoreLineBreaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n");
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return fail(401, "unauthorized", "X-Api-Key が正しくありません");
  }

  // ボディの読み取り。2つの形式を受け付けます。
  //   application/json                   … 通常のJSON
  //   application/x-www-form-urlencoded  … Deluge標準形式。
  //     Deluge側のJSONエスケープが不安定なため、フォーム形式で
  //     送られてくることがあります。こちらの方が確実です。
  let body: Record<string, unknown>;
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      body = {};
      for (const [k, v] of params) body[k] = v;
    } else {
      // 既定はJSON。Content-Type 未指定でもJSONとして試みます。
      body = (await req.json()) as Record<string, unknown>;
    }
  } catch {
    return fail(400, "invalid_json", "リクエストボディを解釈できません");
  }

  const str = (k: string): string | null => {
    const v = body[k];
    if (typeof v === "number") return String(v);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const ticketId = str("ticket_id");
  const rawMessage = str("message") ?? str("body") ?? str("text");
  const message = rawMessage === null ? null : restoreLineBreaks(rawMessage);
  const type = normalizeType(body.type ?? body.kind);
  const staffId = str("staff_id") ?? str("staff");
  const staffName = str("staff_name") ?? str("staffName");
  const memoryVersion = toInt(body.memory ?? body.memory_version);

  const missing: string[] = [];
  if (!ticketId) missing.push("ticket_id");
  if (!message) missing.push("message");
  if (!type) missing.push("type（ai または sent）");
  if (missing.length > 0) {
    return fail(
      400,
      "missing_fields",
      `必須項目が不足しています: ${missing.join(", ")}`,
    );
  }

  try {
    // ── 1. 受信メッセージを保存 ──────────────
    const saved = await saveMessage({
      ticket_id: ticketId!,
      message: message!,
      type: type!,
      staff_id: staffId,
      staff_name: staffName,
      memory_version: memoryVersion,
    });

    // ── 2. ai と sent が揃ったか ─────────────
    const pair = await getPairIfComplete(saved.ticket_id);

    if (!pair) {
      // まだ片方だけ。保存は成功したので success を返します。
      // 判定はペアが揃ってから走ります。
      return NextResponse.json({ result: "success" }, { status: 200 });
    }

    // ── 3. OpenAI で判定 ────────────────────
    const result = await reviewPair({
      ai_body: pair.ai_message,
      sent_body: pair.sent_message,
      generated_prompt_version: null,
    });

    const a = result.analysis;

    // 差分箇所の抽出。複数箇所あってもすべて保持します。
    //   diffs      : OpenAI が返した配列そのまま（正）
    //   diff_pairs : 「① before → after」形式で全件を1行ずつ並べた目視用。
    //                before/after を別列にすると複数件で行がずれるため、
    //                ペアを1行に結んでおく。
    const diffs = a?.diffs ?? null;
    const diffCount = diffs ? diffs.length : 0;
    const diffPairs =
      diffs && diffs.length > 0
        ? diffs
            .map((d, i) => {
              const before = d.before || "（なし）";
              const after = d.after || "（なし）";
              const kind = d.kind ? `　[${d.kind}]` : "";
              return `${i + 1}. ${before} → ${after}${kind}`;
            })
            .join("\n")
        : null;

    // ── 4. 判定結果を保存 ───────────────────
    const judgment = await saveJudgment({
      ticket_id: pair.ticket_id,
      staff_id: pair.staff_id,
      staff_name: pair.staff_name,
      memory_version: pair.memory_version,
      ai_message: pair.ai_message,
      sent_message: pair.sent_message,
      has_diff: result.deterministic.action !== "approve",
      diff_ratio: result.deterministic.diff_ratio,
      fault: result.deterministic.fault,
      fault_reason: result.deterministic.fault_reason,
      diff_summary: a?.summary ?? null,
      diffs,
      diff_count: diffCount,
      diff_pairs: diffPairs,
      analysis: a,
      openai_raw: result.raw,
      model: result.versions.model_resolved,
      review_prompt_version: result.versions.review_prompt_version,
      openai_response_id: result.versions.response_id,
      // OpenAI が失敗しても機械的な判定は保存する。理由だけ残す。
      openai_error: result.error ? result.error.message : null,
    });

    // 保存・判定ともに完了。詳細は review_judgments に入っています。
    return NextResponse.json({ result: "success" }, { status: 200 });
  } catch (err) {
    console.error("[/api/review POST]", err);
    return fail(
      500,
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/* ══ POST 以外は 405 ═════════════════════ */

const ALLOW = "POST";

function methodNotAllowed(method: string): NextResponse {
  return NextResponse.json(
    {
      result: "error",
      code: "method_not_allowed",
      message: `${method} は許可されていません。このエンドポイントは POST 専用です。`,
    },
    { status: 405, headers: { Allow: ALLOW } },
  );
}

export function GET(): NextResponse {
  return methodNotAllowed("GET");
}
export function PUT(): NextResponse {
  return methodNotAllowed("PUT");
}
export function PATCH(): NextResponse {
  return methodNotAllowed("PATCH");
}
export function DELETE(): NextResponse {
  return methodNotAllowed("DELETE");
}

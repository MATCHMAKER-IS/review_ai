import { NextResponse } from "next/server";
import { storeMessage } from "@/lib/messages";
import type { MessageKind } from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * メッセージの受信口。
 *
 *   POST /api/messages
 *   X-Api-Key: <HOOK_SECRET>
 *   Content-Type: application/json
 *
 *   {
 *     "ticket_id": "1234567",   必須  チケットID
 *     "message":   "本文",       必須  メッセージ本文
 *     "kind":      "ai",         必須  "ai" = AIの下書き / "sent" = 実際に送信した文面
 *
 *     "staff_id":       "890123",   任意（強く推奨）担当者ID
 *     "prompt_id":      "pmpt_...", 任意  kind=ai のとき
 *     "prompt_version": "3",        任意  kind=ai のとき
 *     "model":          "gpt-5.6"   任意  kind=ai のとき
 *   }
 *
 * 【動き】
 *   kind="ai"   → 保存するだけ。送信時の文面を待ちます。
 *   kind="sent" → 同じチケットの未ペアの下書きを探して突き合わせ、
 *                 diff計算と切り分けを行い、レビューを1件作ります。
 *
 * 【レスポンス例】
 *   ペア成立時:
 *   {
 *     "message_id": "...", "kind": "sent", "paired": true,
 *     "decision_id": "...", "action": "edit", "diff_ratio": 0.059,
 *     "fault": "generation", "fault_reason": "...", "warnings": []
 *   }
 *
 *   下書きのみ登録時:
 *   { "message_id": "...", "kind": "ai", "paired": false,
 *     "reason": "送信時の文面を待っています。", "warnings": [] }
 *
 * kind の値は "ai" / "sent" のほか、"draft" / "send" / "sended" などの
 * 表記ゆれも受け付けます。Deluge 側の実装に合わせやすくするためです。
 */

const AI_ALIASES = ["ai", "draft", "ai_body", "generated", "0"];
const SENT_ALIASES = ["sent", "send", "sended", "actual", "sent_body", "1"];

function normalizeKind(raw: unknown): MessageKind | null {
  if (typeof raw === "boolean") return raw ? "sent" : "ai";
  if (typeof raw === "number") return raw === 1 ? "sent" : "ai";
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (AI_ALIASES.includes(v)) return "ai";
  if (SENT_ALIASES.includes(v)) return "sent";
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "JSONを解釈できません" },
      { status: 400 },
    );
  }

  const str = (k: string): string | null => {
    const v = body[k];
    if (typeof v === "number") return String(v);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const ticketId = str("ticket_id");
  // message / body / text のどれでも受けます
  const message = str("message") ?? str("body") ?? str("text");
  const kind = normalizeKind(body.kind ?? body.type ?? body.source);

  const missing: string[] = [];
  if (!ticketId) missing.push("ticket_id");
  if (!message) missing.push("message");
  if (!kind) missing.push("kind（ai または sent）");
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `必須項目が不足しています: ${missing.join(", ")}`,
        received: Object.keys(body),
      },
      { status: 400 },
    );
  }

  try {
    const result = await storeMessage({
      ticket_id: ticketId!,
      kind: kind!,
      body: message!,
      staff_id: str("staff_id"),
      prompt_id: str("prompt_id"),
      prompt_version: str("prompt_version"),
      model: str("model"),
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    console.error("[/api/messages]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

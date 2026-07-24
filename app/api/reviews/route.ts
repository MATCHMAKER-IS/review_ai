import { NextResponse } from "next/server";
import { tx } from "@/lib/pg";
import { diffRatio, inferAction } from "@/lib/diff";
import { classify } from "@/lib/learning/classify";
import type { ReviewRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * レビューの受け口。
 *
 * Zoho Desk のワークフローから、AIの下書きと実際に送信された文面を
 * まとめてPOSTしてもらいます。
 *
 *   POST /api/reviews
 *   X-Api-Key: <HOOK_SECRET>
 *   {
 *     "ticket_id": "1234567",        必須
 *     "staff_id": "890123",          必須
 *     "ai_body": "AIが作った下書き",   必須
 *     "sent_body": "実際に送った文面", 必須
 *     "prompt_id": "pmpt_...",       任意だが強く推奨
 *     "prompt_version": "3",         任意だが強く推奨
 *     "model": "gpt-5.6",            任意
 *     "deal_id": "…",                任意
 *     "decision": { … },             任意（①判断AIを分けた場合）
 *     "score": 4,                    任意
 *     "comment": "…",                任意
 *     "decision_ok": true,           任意（承認画面から来る場合）
 *     "corrected_next_action": "…",  任意
 *     "corrected_recipient": "男性"   任意
 *   }
 *
 * 【この中でOpenAIは呼びません】
 *   diff計算も §7 の切り分けも純粋な関数です。LLMを挟むと
 *   遅くなるうえ、④の誤判定が①②の誤りと混ざって切り分け不能になります。
 *   ルール抽出は溜まったレビューをまとめて分析する別処理で行います。
 *   このエンドポイントは常に高速・確実に返ります。
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSONを解釈できません" }, { status: 400 });
  }

  const str = (k: string): string | null => {
    const v = body[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const ticketId = str("ticket_id");
  const staffId = str("staff_id");
  const aiBody = str("ai_body");
  const sentBody = str("sent_body");

  const missing: string[] = [];
  if (!ticketId) missing.push("ticket_id");
  if (!staffId) missing.push("staff_id");
  if (!aiBody) missing.push("ai_body");
  if (!sentBody) missing.push("sent_body");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `必須項目が不足しています: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  const promptVersion = str("prompt_version");
  const ratio = diffRatio(aiBody!, sentBody!);
  const action = inferAction(aiBody!, sentBody!);

  // §7 の切り分け。ここで確定させてDBに書くので、後から集計するだけで
  // 「判断AIのミス率」「生成AIのミス率」が出せます。
  const provisional: ReviewRecord = {
    decision_id: "",
    staff_id: staffId!,
    action,
    score: typeof body.score === "number" ? body.score : null,
    comment: str("comment"),
    ai_body: aiBody!,
    sent_body: sentBody!,
    diff_ratio: ratio,
    reviewed_at: new Date().toISOString(),
    decision_ok:
      typeof body.decision_ok === "boolean" ? body.decision_ok : null,
    corrected_next_action: str("corrected_next_action") as never,
    corrected_recipient: str("corrected_recipient") as never,
  };
  const classified = classify(provisional);

  try {
    const decisionId = await tx(async (c) => {
      const runRes = await c.query<{ decision_id: string }>(
        `INSERT INTO runs
           (ticket_id, deal_id, staff_id, status, ai_body,
            decision, draft, context_pack, prompt_id, prompt_version, model)
         VALUES ($1,$2,$3,'reviewed',$4,$5,$6,$7,$8,$9,$10)
         RETURNING decision_id`,
        [
          ticketId,
          str("deal_id"),
          staffId,
          aiBody,
          body.decision ? JSON.stringify(body.decision) : null,
          body.draft ? JSON.stringify(body.draft) : null,
          body.context_pack ? JSON.stringify(body.context_pack) : null,
          str("prompt_id"),
          promptVersion,
          str("model"),
        ],
      );
      const id = runRes.rows[0]!.decision_id;

      await c.query(
        `INSERT INTO reviews
           (decision_id, staff_id, action, score, comment,
            ai_body, sent_body, diff_ratio, fault, fault_reason,
            decision_ok, corrected_next_action, corrected_recipient)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          staffId,
          action,
          provisional.score,
          provisional.comment,
          aiBody,
          sentBody,
          ratio,
          classified.fault,
          classified.reason,
          provisional.decision_ok,
          provisional.corrected_next_action,
          provisional.corrected_recipient,
        ],
      );

      // ルールの適用実績を加算（引退判定の材料）
      const used = Array.isArray((body.draft as { used_memory_rules?: unknown })?.used_memory_rules)
        ? ((body.draft as { used_memory_rules: string[] }).used_memory_rules)
        : [];
      for (const ruleId of used) {
        await c.query(
          `INSERT INTO rule_usage (staff_id, rule_id, hits, last_used_at)
           VALUES ($1,$2,1,now())
           ON CONFLICT (staff_id, rule_id)
           DO UPDATE SET hits = rule_usage.hits + 1, last_used_at = now()`,
          [staffId, ruleId],
        );
      }

      return id;
    });

    return NextResponse.json({
      decision_id: decisionId,
      action,
      diff_ratio: ratio,
      fault: classified.fault,
      fault_reason: classified.reason,
      warning:
        promptVersion === null
          ? "prompt_version が未指定です。どの版の下書きへのレビューかを後から特定できません。"
          : null,
    });
  } catch (err) {
    console.error("[/api/reviews]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

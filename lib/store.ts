/**
 * 受信メッセージと判定結果の保存（PostgreSQL）
 */

import { queryOne } from "./pg";

export type MessageType = "ai" | "sent";

export interface IncomingMessage {
  ticket_id: string;
  message: string;
  type: MessageType;
  staff_id: string | null;
  memory_version: number | null;
}

export interface SavedMessage {
  id: string;
  ticket_id: string;
  type: MessageType;
  received_at: string;
}

/** 受信メッセージを1行INSERTします。 */
export async function saveMessage(m: IncomingMessage): Promise<SavedMessage> {
  const row = await queryOne<{
    id: string;
    ticket_id: string;
    type: MessageType;
    received_at: Date;
  }>(
    `INSERT INTO review_messages
       (ticket_id, message, type, staff_id, memory_version)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, ticket_id, type, received_at`,
    [m.ticket_id, m.message, m.type, m.staff_id, m.memory_version],
  );
  if (!row) throw new Error("INSERT に失敗しました");
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    type: row.type,
    received_at: row.received_at.toISOString(),
  };
}

/* ─── ペアの取得 ─────────────────────────── */

export interface MessagePair {
  ticket_id: string;
  ai_message: string;
  sent_message: string;
  staff_id: string | null;
  memory_version: number | null;
}

/**
 * 同じ ticket_id に ai と sent が両方そろっているかを調べ、
 * 揃っていればペアを返します。片方しか無ければ null。
 *
 * それぞれ最新の1件を採用します（同種が複数あっても最後のものを見る）。
 * staff_id と memory_version は ai 側を優先します。
 */
export async function getPairIfComplete(
  ticketId: string,
): Promise<MessagePair | null> {
  const row = await queryOne<{
    ai_message: string;
    sent_message: string;
    staff_id: string | null;
    memory_version: number | null;
  }>(
    `WITH latest_ai AS (
       SELECT message, staff_id, memory_version
         FROM review_messages
        WHERE ticket_id = $1 AND type = 'ai'
        ORDER BY received_at DESC LIMIT 1
     ),
     latest_sent AS (
       SELECT message
         FROM review_messages
        WHERE ticket_id = $1 AND type = 'sent'
        ORDER BY received_at DESC LIMIT 1
     )
     SELECT
       a.message         AS ai_message,
       s.message         AS sent_message,
       a.staff_id        AS staff_id,
       a.memory_version  AS memory_version
     FROM latest_ai a
     CROSS JOIN latest_sent s`,
    [ticketId],
  );

  if (!row) return null;
  return {
    ticket_id: ticketId,
    ai_message: row.ai_message,
    sent_message: row.sent_message,
    staff_id: row.staff_id,
    memory_version: row.memory_version,
  };
}

/* ─── 判定結果の保存 ───────────────────────── */

export interface JudgmentToSave {
  ticket_id: string;
  staff_id: string | null;
  memory_version: number | null;
  ai_message: string;
  sent_message: string;
  has_diff: boolean;
  diff_ratio: number;
  fault: string;
  fault_reason: string | null;
  diff_summary: string | null;
  diffs: unknown | null;        // [{before, after, kind}, ...]（正）
  diff_count: number;           // 差分の個数
  diff_pairs: string | null;    // 「① before → after」形式の目視用
  analysis: unknown | null;
  model: string | null;
  review_prompt_version: string | null;
  openai_response_id: string | null;
  openai_error: string | null;
}

/**
 * 判定結果を保存します。
 * 1チケット1判定なので、既にあれば上書きします（ON CONFLICT）。
 * 再送で sent が更新された場合も、最新の判定に置き換わります。
 */
export async function saveJudgment(j: JudgmentToSave): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO review_judgments
       (ticket_id, staff_id, memory_version, ai_message, sent_message,
        has_diff, diff_ratio, fault, fault_reason, diff_summary,
        diffs, diff_count, diff_pairs, analysis,
        model, review_prompt_version, openai_response_id, openai_error)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (ticket_id) DO UPDATE SET
       staff_id              = EXCLUDED.staff_id,
       memory_version        = EXCLUDED.memory_version,
       ai_message            = EXCLUDED.ai_message,
       sent_message          = EXCLUDED.sent_message,
       has_diff              = EXCLUDED.has_diff,
       diff_ratio            = EXCLUDED.diff_ratio,
       fault                 = EXCLUDED.fault,
       fault_reason          = EXCLUDED.fault_reason,
       diff_summary          = EXCLUDED.diff_summary,
       diffs                 = EXCLUDED.diffs,
       diff_count            = EXCLUDED.diff_count,
       diff_pairs            = EXCLUDED.diff_pairs,
       analysis              = EXCLUDED.analysis,
       model                 = EXCLUDED.model,
       review_prompt_version = EXCLUDED.review_prompt_version,
       openai_response_id    = EXCLUDED.openai_response_id,
       openai_error          = EXCLUDED.openai_error,
       judged_at             = now()
     RETURNING id`,
    [
      j.ticket_id,
      j.staff_id,
      j.memory_version,
      j.ai_message,
      j.sent_message,
      j.has_diff,
      j.diff_ratio,
      j.fault,
      j.fault_reason,
      j.diff_summary,
      j.diffs === null ? null : JSON.stringify(j.diffs),
      j.diff_count,
      j.diff_pairs,
      j.analysis === null ? null : JSON.stringify(j.analysis),
      j.model,
      j.review_prompt_version,
      j.openai_response_id,
      j.openai_error,
    ],
  );
  if (!row) throw new Error("判定結果の保存に失敗しました");
  return { id: row.id };
}

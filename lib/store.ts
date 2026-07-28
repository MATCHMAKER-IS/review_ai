/**
 * 受信メッセージと判定結果の保存（PostgreSQL）
 */

import { query, queryOne } from "./pg";

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
  openai_raw: unknown | null;   // OpenAI レスポンス全文
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
        diffs, diff_count, diff_pairs, analysis, openai_raw,
        model, review_prompt_version, openai_response_id, openai_error)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
       openai_raw            = EXCLUDED.openai_raw,
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
      j.openai_raw === null ? null : JSON.stringify(j.openai_raw),
      j.model,
      j.review_prompt_version,
      j.openai_response_id,
      j.openai_error,
    ],
  );
  if (!row) throw new Error("判定結果の保存に失敗しました");
  return { id: row.id };
}

/* ─── 画面表示用の取得 ───────────────────── */

export interface JudgmentListItem {
  ticket_id: string;
  staff_id: string | null;
  has_diff: boolean;
  diff_ratio: number;
  diff_count: number;
  fault: string;
  diff_summary: string | null;
  model: string | null;
  openai_error: string | null;
  judged_at: string;
}

export interface JudgmentFilter {
  ticket_id?: string;
  staff_id?: string;
  keyword?: string; // ai_message / sent_message の部分一致
  fault?: string;
  date_from?: string;
  date_to?: string;
}

function buildJudgmentWhere(f: JudgmentFilter): {
  clause: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  const ph = (val: unknown): string => {
    params.push(val);
    return `$${params.length}`;
  };

  if (f.ticket_id) conds.push(`ticket_id ILIKE ${ph(`%${f.ticket_id}%`)}`);
  if (f.staff_id) conds.push(`staff_id ILIKE ${ph(`%${f.staff_id}%`)}`);
  if (f.keyword) {
    const a = ph(`%${f.keyword}%`);
    const b = ph(`%${f.keyword}%`);
    conds.push(`(ai_message ILIKE ${a} OR sent_message ILIKE ${b})`);
  }
  if (f.fault) conds.push(`fault = ${ph(f.fault)}`);
  if (f.date_from) conds.push(`judged_at >= ${ph(`${f.date_from} 00:00:00`)}`);
  if (f.date_to) conds.push(`judged_at <= ${ph(`${f.date_to} 23:59:59`)}`);

  return {
    clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

/** 一覧画面。判定結果を新しい順に、検索条件付きで返します。 */
export async function listJudgments(
  f: JudgmentFilter = {},
  limit = 50,
  offset = 0,
): Promise<JudgmentListItem[]> {
  const { clause, params } = buildJudgmentWhere(f);
  const rows = await query<{
    ticket_id: string;
    staff_id: string | null;
    has_diff: boolean;
    diff_ratio: string;
    diff_count: number;
    fault: string;
    diff_summary: string | null;
    model: string | null;
    openai_error: string | null;
    judged_at: Date;
  }>(
    `SELECT ticket_id, staff_id, has_diff, diff_ratio, diff_count,
            fault, diff_summary, model, openai_error, judged_at
       FROM review_judgments
       ${clause}
      ORDER BY judged_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    staff_id: r.staff_id,
    has_diff: r.has_diff,
    diff_ratio: Number(r.diff_ratio),
    diff_count: r.diff_count,
    fault: r.fault,
    diff_summary: r.diff_summary,
    model: r.model,
    openai_error: r.openai_error,
    judged_at: r.judged_at.toISOString(),
  }));
}

export async function countJudgments(f: JudgmentFilter = {}): Promise<number> {
  const { clause, params } = buildJudgmentWhere(f);
  const r = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM review_judgments ${clause}`,
    params,
  );
  return Number(r?.c ?? 0);
}

export interface DiffEntry {
  before: string;
  after: string;
  kind: string;
}

export interface JudgmentDetail {
  ticket_id: string;
  staff_id: string | null;
  memory_version: number | null;
  ai_message: string;
  sent_message: string;
  has_diff: boolean;
  diff_ratio: number;
  diff_count: number;
  diffs: DiffEntry[];
  diff_pairs: string | null;
  fault: string;
  fault_reason: string | null;
  diff_summary: string | null;
  analysis: unknown;
  openai_raw: unknown;
  model: string | null;
  review_prompt_version: string | null;
  openai_response_id: string | null;
  openai_error: string | null;
  judged_at: string;
  updated_at: string;
}

/** 詳細画面。1チケット分の全項目を返します。 */
export async function getJudgment(
  ticketId: string,
): Promise<JudgmentDetail | null> {
  const r = await queryOne<{
    ticket_id: string;
    staff_id: string | null;
    memory_version: number | null;
    ai_message: string;
    sent_message: string;
    has_diff: boolean;
    diff_ratio: string;
    diff_count: number;
    diffs: DiffEntry[] | null;
    diff_pairs: string | null;
    fault: string;
    fault_reason: string | null;
    diff_summary: string | null;
    analysis: unknown;
    openai_raw: unknown;
    model: string | null;
    review_prompt_version: string | null;
    openai_response_id: string | null;
    openai_error: string | null;
    judged_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM review_judgments WHERE ticket_id = $1`,
    [ticketId],
  );
  if (!r) return null;
  return {
    ticket_id: r.ticket_id,
    staff_id: r.staff_id,
    memory_version: r.memory_version,
    ai_message: r.ai_message,
    sent_message: r.sent_message,
    has_diff: r.has_diff,
    diff_ratio: Number(r.diff_ratio),
    diff_count: r.diff_count,
    diffs: Array.isArray(r.diffs) ? r.diffs : [],
    diff_pairs: r.diff_pairs,
    fault: r.fault,
    fault_reason: r.fault_reason,
    diff_summary: r.diff_summary,
    analysis: r.analysis,
    openai_raw: r.openai_raw,
    model: r.model,
    review_prompt_version: r.review_prompt_version,
    openai_response_id: r.openai_response_id,
    openai_error: r.openai_error,
    judged_at: r.judged_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/* ─── メッセージ一覧・詳細（画面用）───────────── */

export interface MessageListItem {
  id: string;
  ticket_id: string;
  type: MessageType;
  message: string;
  staff_id: string | null;
  memory_version: number | null;
  received_at: string;
}

export interface MessageFilter {
  ticket_id?: string;
  staff_id?: string;
  keyword?: string; // message の部分一致
  type?: MessageType;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;
}

/** WHERE 句とパラメータを組み立てます（メッセージ用）。 */
function buildMessageWhere(f: MessageFilter): {
  clause: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  const ph = (val: unknown): string => {
    params.push(val);
    return `$${params.length}`;
  };

  if (f.ticket_id) conds.push(`ticket_id ILIKE ${ph(`%${f.ticket_id}%`)}`);
  if (f.staff_id) conds.push(`staff_id ILIKE ${ph(`%${f.staff_id}%`)}`);
  if (f.keyword) conds.push(`message ILIKE ${ph(`%${f.keyword}%`)}`);
  if (f.type) conds.push(`type = ${ph(f.type)}`);
  if (f.date_from) conds.push(`received_at >= ${ph(`${f.date_from} 00:00:00`)}`);
  if (f.date_to) conds.push(`received_at <= ${ph(`${f.date_to} 23:59:59`)}`);

  return {
    clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

export async function listMessages(
  f: MessageFilter,
  limit = 50,
  offset = 0,
): Promise<MessageListItem[]> {
  const { clause, params } = buildMessageWhere(f);
  const rows = await query<{
    id: string;
    ticket_id: string;
    type: MessageType;
    message: string;
    staff_id: string | null;
    memory_version: number | null;
    received_at: Date;
  }>(
    `SELECT id, ticket_id, type, message, staff_id, memory_version, received_at
       FROM review_messages
       ${clause}
      ORDER BY received_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id,
    type: r.type,
    message: r.message,
    staff_id: r.staff_id,
    memory_version: r.memory_version,
    received_at: r.received_at.toISOString(),
  }));
}

export async function countMessages(f: MessageFilter): Promise<number> {
  const { clause, params } = buildMessageWhere(f);
  const r = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM review_messages ${clause}`,
    params,
  );
  return Number(r?.c ?? 0);
}

export async function getMessage(
  id: string,
): Promise<MessageListItem | null> {
  const r = await queryOne<{
    id: string;
    ticket_id: string;
    type: MessageType;
    message: string;
    staff_id: string | null;
    memory_version: number | null;
    received_at: Date;
  }>(
    `SELECT id, ticket_id, type, message, staff_id, memory_version, received_at
       FROM review_messages WHERE id = $1`,
    [id],
  );
  if (!r) return null;
  return {
    id: r.id,
    ticket_id: r.ticket_id,
    type: r.type,
    message: r.message,
    staff_id: r.staff_id,
    memory_version: r.memory_version,
    received_at: r.received_at.toISOString(),
  };
}

/** 同じチケットの ai / sent 両方を時系列で。詳細で並べて見る用。 */
export async function getMessagesByTicket(
  ticketId: string,
): Promise<MessageListItem[]> {
  const rows = await query<{
    id: string;
    ticket_id: string;
    type: MessageType;
    message: string;
    staff_id: string | null;
    memory_version: number | null;
    received_at: Date;
  }>(
    `SELECT id, ticket_id, type, message, staff_id, memory_version, received_at
       FROM review_messages WHERE ticket_id = $1
      ORDER BY received_at ASC`,
    [ticketId],
  );
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id,
    type: r.type,
    message: r.message,
    staff_id: r.staff_id,
    memory_version: r.memory_version,
    received_at: r.received_at.toISOString(),
  }));
}

/**
 * メッセージの受信とペアリング。
 *
 * ①AIの下書きと②実際に送信した文面は、別々のタイミングで届きます。
 *   下書き作成時 → type='ai'
 *   返信送信時   → type='sent'
 *
 * 'sent' が届いた時点で、同じチケットの未ペアの 'ai' を探して突き合わせ、
 * diff計算と§7の切り分けを行い、レビューを作ります。
 *
 * ────────────────────────────────────────
 * 【保存先について】
 *
 * ペアリングには「'ai' を受け取ってから 'sent' が来るまで保持する」
 * 状態が必要です。Lambdaはリクエストごとに別インスタンスになりうるため、
 * 本番では必ずDBが要ります。
 *
 * DATABASE_URL が未設定の場合はプロセス内のメモリに退避します。
 *   - npm run dev は単一プロセスなので確実に動きます
 *   - Lambda では同じインスタンスに当たった場合のみ動きます（不確実）
 * この状態では警告を返します。DB接続を作り込むまでの暫定です。
 * ────────────────────────────────────────
 */

import { query, queryOne, tx } from "./pg";
import { diffRatio, inferAction, normalizeBody } from "./diff";
import { classify } from "./learning/classify";
import type { ReviewRecord } from "./types";

export type MessageKind = "ai" | "sent";

export interface IncomingMessage {
  ticket_id: string;
  kind: MessageKind;
  body: string;
  staff_id: string | null;
  /** ④が育てるメモリの版数。この版が生成した下書きか、を示す */
  memory_version: number | null;
  prompt_id: string | null;
  prompt_version: string | null;
  model: string | null;
}

export interface StoreResult {
  ticket_id: string;
  kind: MessageKind;
  stored: boolean;
  paired: boolean;
  duplicate: boolean;
  storage: "db" | "memory";
  message_id?: string;
  decision_id?: string;
  /** ペア成立時のみ。LLMを使わず機械的に決まる部分 */
  action?: "approve" | "edit";
  diff_ratio?: number;
  fault?: string;
  fault_reason?: string;
  ai_body?: string;
  sent_body?: string;
  reason?: string;
  warnings: string[];
}

const DEDUP_WINDOW_MINUTES = 10;
const dbEnabled = (): boolean => Boolean(process.env.DATABASE_URL);

/* ─── DB無しのときの退避先 ─────────────────── */

interface PendingDraft {
  body: string;
  staff_id: string;
  memory_version: number | null;
  prompt_id: string | null;
  prompt_version: string | null;
  model: string | null;
  at: number;
}

const g = globalThis as unknown as { __pendingDrafts?: Map<string, PendingDraft> };
const pending: Map<string, PendingDraft> =
  g.__pendingDrafts ?? (g.__pendingDrafts = new Map<string, PendingDraft>());

const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

function prunePending(): void {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.at > MEMORY_TTL_MS) pending.delete(k);
  }
}

/* ─── 共通 ───────────────────────────────── */

/**
 * 突き合わせ本体。保存先に関係なく同じ計算をします。
 * ここでLLMは呼びません。diff も §7 の切り分けも純粋な関数です。
 */
function evaluate(aiBody: string, sentBody: string, staffId: string) {
  const ratio = diffRatio(aiBody, sentBody);
  const action = inferAction(aiBody, sentBody);
  const provisional: ReviewRecord = {
    decision_id: "",
    staff_id: staffId,
    action,
    score: null,
    comment: null,
    ai_body: aiBody,
    sent_body: sentBody,
    diff_ratio: ratio,
    reviewed_at: new Date().toISOString(),
    decision_ok: null,
    corrected_next_action: null,
    corrected_recipient: null,
  };
  return { ratio, action, classified: classify(provisional) };
}

export async function storeMessage(m: IncomingMessage): Promise<StoreResult> {
  const warnings: string[] = [];
  const staffId = m.staff_id ?? "unknown";

  if (m.staff_id === null) {
    warnings.push(
      "staff_id が未指定です。メモリはスタッフ個別に育てる設計のため、このままだと全員分が1つのメモリに混ざります。",
    );
  }
  if (m.kind === "ai" && m.memory_version === null) {
    warnings.push(
      "memory が未指定です。どの版のメモリが生成した下書きかを特定できず、メモリ更新の効果を測れません。",
    );
  }

  if (!dbEnabled()) {
    warnings.push(
      "DATABASE_URL が未設定のため、プロセス内メモリに保持しています。ローカル開発では確実に動きますが、Lambda上では同じインスタンスに当たった場合のみ成立します。",
    );
    return handleInMemory(m, staffId, warnings);
  }

  return handleWithDb(m, staffId, warnings);
}

/* ─── メモリ退避版（DB未設定時）─────────────── */

function handleInMemory(
  m: IncomingMessage,
  staffId: string,
  warnings: string[],
): StoreResult {
  prunePending();

  if (m.kind === "ai") {
    pending.set(m.ticket_id, {
      body: m.body,
      staff_id: staffId,
      memory_version: m.memory_version,
      prompt_id: m.prompt_id,
      prompt_version: m.prompt_version,
      model: m.model,
      at: Date.now(),
    });
    return {
      ticket_id: m.ticket_id,
      kind: "ai",
      stored: true,
      paired: false,
      duplicate: false,
      storage: "memory",
      reason: "送信時の文面を待っています。",
      warnings,
    };
  }

  const draft = pending.get(m.ticket_id);
  if (!draft) {
    return {
      ticket_id: m.ticket_id,
      kind: "sent",
      stored: false,
      paired: false,
      duplicate: false,
      storage: "memory",
      reason:
        "このチケットに未ペアのAI下書きがありません。先に type=ai を送るか、DBを設定してください。",
      warnings,
    };
  }

  pending.delete(m.ticket_id);
  const effectiveStaff = draft.staff_id !== "unknown" ? draft.staff_id : staffId;
  const { ratio, action, classified } = evaluate(draft.body, m.body, effectiveStaff);

  if (normalizeBody(draft.body) === normalizeBody(m.body)) {
    warnings.push("下書きがそのまま送信されました。学習対象にはなりません。");
  }

  return {
    ticket_id: m.ticket_id,
    kind: "sent",
    stored: true,
    paired: true,
    duplicate: false,
    storage: "memory",
    action,
    diff_ratio: ratio,
    fault: classified.fault,
    fault_reason: classified.reason,
    ai_body: draft.body,
    sent_body: m.body,
    warnings,
  };
}

/* ─── DB版 ───────────────────────────────── */

async function handleWithDb(
  m: IncomingMessage,
  staffId: string,
  warnings: string[],
): Promise<StoreResult> {
  // 重複POSTの検知。Zohoのワークフローは二重発火することがあり、
  // 素通しするとレビューが2件できて §7 の指標が狂います。
  const dup = await queryOne<{ message_id: string; paired_at: Date | null }>(
    `SELECT message_id, paired_at FROM messages
      WHERE ticket_id = $1 AND kind = $2 AND body = $3
        AND created_at > now() - ($4 || ' minutes')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [m.ticket_id, m.kind, m.body, String(DEDUP_WINDOW_MINUTES)],
  );
  if (dup) {
    return {
      ticket_id: m.ticket_id,
      kind: m.kind,
      stored: false,
      paired: dup.paired_at !== null,
      duplicate: true,
      storage: "db",
      message_id: dup.message_id,
      reason: `直近${DEDUP_WINDOW_MINUTES}分以内に同一内容が登録済みです。重複として無視しました。`,
      warnings,
    };
  }

  if (m.kind === "ai") {
    const row = await queryOne<{ message_id: string }>(
      `INSERT INTO messages
         (ticket_id, kind, body, staff_id, memory_version, prompt_id, prompt_version, model)
       VALUES ($1,'ai',$2,$3,$4,$5,$6,$7)
       RETURNING message_id`,
      [
        m.ticket_id,
        m.body,
        staffId,
        m.memory_version,
        m.prompt_id,
        m.prompt_version,
        m.model,
      ],
    );
    return {
      ticket_id: m.ticket_id,
      kind: "ai",
      stored: true,
      paired: false,
      duplicate: false,
      storage: "db",
      message_id: row!.message_id,
      reason: "送信時の文面を待っています。",
      warnings,
    };
  }

  // 同じチケットの未ペアの下書きのうち、最も新しいもの。
  // 往復の多い案件では下書きが複数溜まるため、直近のものと組みます。
  const draft = await queryOne<{
    message_id: string;
    body: string;
    staff_id: string;
    memory_version: number | null;
    prompt_id: string | null;
    prompt_version: string | null;
    model: string | null;
  }>(
    `SELECT message_id, body, staff_id, memory_version, prompt_id, prompt_version, model
       FROM messages
      WHERE ticket_id = $1 AND kind = 'ai' AND paired_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [m.ticket_id],
  );

  // 下書きが無い＝AIを使わずに書かれた返信。学習対象外ですが記録は残します。
  if (!draft) {
    const row = await queryOne<{ message_id: string }>(
      `INSERT INTO messages (ticket_id, kind, body, staff_id)
       VALUES ($1,'sent',$2,$3) RETURNING message_id`,
      [m.ticket_id, m.body, staffId],
    );
    return {
      ticket_id: m.ticket_id,
      kind: "sent",
      stored: true,
      paired: false,
      duplicate: false,
      storage: "db",
      message_id: row!.message_id,
      reason:
        "このチケットに未ペアのAI下書きがありません。AIを経由せず送信された返信として記録しました。",
      warnings,
    };
  }

  const effectiveStaff = draft.staff_id !== "unknown" ? draft.staff_id : staffId;
  const { ratio, action, classified } = evaluate(draft.body, m.body, effectiveStaff);

  const ids = await tx(async (c) => {
    const runRes = await c.query<{ decision_id: string }>(
      `INSERT INTO runs
         (ticket_id, staff_id, status, ai_body,
          memory_version, prompt_id, prompt_version, model)
       VALUES ($1,$2,'reviewed',$3,$4,$5,$6,$7)
       RETURNING decision_id`,
      [
        m.ticket_id,
        effectiveStaff,
        draft.body,
        draft.memory_version,
        draft.prompt_id,
        draft.prompt_version,
        draft.model,
      ],
    );
    const decisionId = runRes.rows[0]!.decision_id;

    await c.query(
      `INSERT INTO reviews
         (decision_id, staff_id, action, ai_body, sent_body,
          diff_ratio, fault, fault_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        decisionId,
        effectiveStaff,
        action,
        draft.body,
        m.body,
        ratio,
        classified.fault,
        classified.reason,
      ],
    );

    const sentRes = await c.query<{ message_id: string }>(
      `INSERT INTO messages
         (ticket_id, kind, body, staff_id, memory_version, paired_at, decision_id)
       VALUES ($1,'sent',$2,$3,$4,now(),$5)
       RETURNING message_id`,
      [m.ticket_id, m.body, effectiveStaff, draft.memory_version, decisionId],
    );

    await c.query(
      `UPDATE messages SET paired_at = now(), decision_id = $2 WHERE message_id = $1`,
      [draft.message_id, decisionId],
    );

    return { sentId: sentRes.rows[0]!.message_id, decisionId };
  });

  if (normalizeBody(draft.body) === normalizeBody(m.body)) {
    warnings.push("下書きがそのまま送信されました。学習対象にはなりません。");
  }

  return {
    ticket_id: m.ticket_id,
    kind: "sent",
    stored: true,
    paired: true,
    duplicate: false,
    storage: "db",
    message_id: ids.sentId,
    decision_id: ids.decisionId,
    action,
    diff_ratio: ratio,
    fault: classified.fault,
    fault_reason: classified.reason,
    ai_body: draft.body,
    sent_body: m.body,
    warnings,
  };
}

/** 送信されないまま残っている下書き。破棄率の把握に使います。 */
export async function orphanDrafts(limit = 50): Promise<unknown[]> {
  if (!dbEnabled()) return [];
  return query(`SELECT * FROM orphan_drafts LIMIT $1`, [limit]);
}

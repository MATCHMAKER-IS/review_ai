/**
 * メッセージの受信とペアリング。
 *
 * ①AIの下書きと②実際に送信した文面は、別々のタイミングで届きます。
 *   下書き作成時   → kind='ai'
 *   返信送信時     → kind='sent'
 *
 * 'sent' が届いた時点で、同じチケットの未ペアの 'ai' を探して突き合わせ、
 * diff計算と§7の切り分けを行い、runs と reviews を作ります。
 *
 * 【ここでOpenAIは呼びません】
 *   diff計算も切り分けも純粋な関数です。LLMを挟むと遅くなるうえ、
 *   ④の誤判定が①②の誤りと混ざって切り分け不能になります。
 *   ルール抽出は溜まったレビューをまとめて分析する別処理です。
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
  prompt_id: string | null;
  prompt_version: string | null;
  model: string | null;
}

export interface StoreResult {
  message_id: string;
  kind: MessageKind;
  paired: boolean;
  duplicate: boolean;
  /** ペア成立時のみ */
  decision_id?: string;
  action?: "approve" | "edit" | "reject";
  diff_ratio?: number;
  fault?: string;
  fault_reason?: string;
  /** ペアが見つからなかった理由 */
  reason?: string;
  warnings: string[];
}

/**
 * 重複POSTの検知。
 * Zoho のワークフローは条件によって二重発火することがあり、
 * そのまま受けるとレビューが2件できて §7 の指標が狂います。
 */
const DEDUP_WINDOW_MINUTES = 10;

async function findDuplicate(
  m: IncomingMessage,
): Promise<{ message_id: string; paired_at: Date | null } | null> {
  return queryOne<{ message_id: string; paired_at: Date | null }>(
    `SELECT message_id, paired_at FROM messages
      WHERE ticket_id = $1 AND kind = $2 AND body = $3
        AND created_at > now() - ($4 || ' minutes')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [m.ticket_id, m.kind, m.body, String(DEDUP_WINDOW_MINUTES)],
  );
}

export async function storeMessage(m: IncomingMessage): Promise<StoreResult> {
  const warnings: string[] = [];
  const staffId = m.staff_id ?? "unknown";

  if (m.staff_id === null) {
    warnings.push(
      "staff_id が未指定です。メモリはスタッフ個別に育てる設計のため、このままだと全員分が1つに混ざります。",
    );
  }
  if (m.kind === "ai" && m.prompt_version === null) {
    warnings.push(
      "prompt_version が未指定です。どの版の下書きへのレビューかを後から特定できません。",
    );
  }

  // ── 重複チェック ─────────────────────────
  const dup = await findDuplicate(m);
  if (dup) {
    return {
      message_id: dup.message_id,
      kind: m.kind,
      paired: dup.paired_at !== null,
      duplicate: true,
      reason: `直近${DEDUP_WINDOW_MINUTES}分以内に同一内容が登録済みです。重複として無視しました。`,
      warnings,
    };
  }

  // ── kind = 'ai' : 保存するだけ ────────────
  if (m.kind === "ai") {
    const row = await queryOne<{ message_id: string }>(
      `INSERT INTO messages
         (ticket_id, kind, body, staff_id, prompt_id, prompt_version, model)
       VALUES ($1,'ai',$2,$3,$4,$5,$6)
       RETURNING message_id`,
      [m.ticket_id, m.body, staffId, m.prompt_id, m.prompt_version, m.model],
    );
    return {
      message_id: row!.message_id,
      kind: "ai",
      paired: false,
      duplicate: false,
      reason: "送信時の文面を待っています。",
      warnings,
    };
  }

  // ── kind = 'sent' : ペアを探して突き合わせ ──
  return pairWithDraft(m, staffId, warnings);
}

async function pairWithDraft(
  m: IncomingMessage,
  staffId: string,
  warnings: string[],
): Promise<StoreResult> {
  // 同じチケットの未ペアの下書きのうち、最も新しいもの。
  // 往復の多い案件では下書きが複数溜まるため、直近のものと組みます。
  const draft = await queryOne<{
    message_id: string;
    body: string;
    staff_id: string;
    prompt_id: string | null;
    prompt_version: string | null;
    model: string | null;
  }>(
    `SELECT message_id, body, staff_id, prompt_id, prompt_version, model
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
      message_id: row!.message_id,
      kind: "sent",
      paired: false,
      duplicate: false,
      reason:
        "このチケットに未ペアのAI下書きがありません。AIを経由せず送信された返信として記録しました。",
      warnings,
    };
  }

  const aiBody = draft.body;
  const sentBody = m.body;

  // staff_id は下書き側を優先します。下書きを作った担当と
  // 送信した担当が同じである前提で、記録の一貫性を保つためです。
  const effectiveStaff =
    draft.staff_id !== "unknown" ? draft.staff_id : staffId;

  const ratio = diffRatio(aiBody, sentBody);
  const action = inferAction(aiBody, sentBody);

  // §7 の切り分け。書き込み時に確定させるので、後から集計するだけで
  // 「判断AIのミス率」「生成AIのミス率」が出せます。
  const provisional: ReviewRecord = {
    decision_id: "",
    staff_id: effectiveStaff,
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
  const classified = classify(provisional);

  const sentMessageId = await tx(async (c) => {
    const runRes = await c.query<{ decision_id: string }>(
      `INSERT INTO runs
         (ticket_id, staff_id, status, ai_body, prompt_id, prompt_version, model)
       VALUES ($1,$2,'reviewed',$3,$4,$5,$6)
       RETURNING decision_id`,
      [
        m.ticket_id,
        effectiveStaff,
        aiBody,
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
        aiBody,
        sentBody,
        ratio,
        classified.fault,
        classified.reason,
      ],
    );

    const sentRes = await c.query<{ message_id: string }>(
      `INSERT INTO messages
         (ticket_id, kind, body, staff_id, paired_at, decision_id)
       VALUES ($1,'sent',$2,$3,now(),$4)
       RETURNING message_id`,
      [m.ticket_id, sentBody, effectiveStaff, decisionId],
    );

    await c.query(
      `UPDATE messages SET paired_at = now(), decision_id = $2
        WHERE message_id = $1`,
      [draft.message_id, decisionId],
    );

    return { sentId: sentRes.rows[0]!.message_id, decisionId };
  });

  if (normalizeBody(aiBody) === normalizeBody(sentBody)) {
    warnings.push("下書きがそのまま送信されました。学習対象にはなりません。");
  }

  return {
    message_id: sentMessageId.sentId,
    kind: "sent",
    paired: true,
    duplicate: false,
    decision_id: sentMessageId.decisionId,
    action,
    diff_ratio: ratio,
    fault: classified.fault,
    fault_reason: classified.reason,
    warnings,
  };
}

/** 送信されないまま残っている下書き。破棄率の把握に使います。 */
export async function orphanDrafts(limit = 50): Promise<unknown[]> {
  return query(`SELECT * FROM orphan_drafts LIMIT $1`, [limit]);
}

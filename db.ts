import { query, queryOne, tx } from "./pg";
import type {
  Decision,
  MemoryProposal,
  ProposalStatus,
  ReviewRecord,
  StaffMemory,
} from "./types";
import { emptyMemory } from "./types";

/* ─── レビュー ───────────────────────────── */

interface ReviewRow {
  decision_id: string;
  staff_id: string;
  action: string;
  score: number | null;
  comment: string | null;
  ai_body: string;
  sent_body: string;
  diff_ratio: string;
  fault: string;
  fault_reason: string;
  decision_ok: boolean | null;
  corrected_next_action: string | null;
  corrected_recipient: string | null;
  reviewed_at: Date;
}

/** NUMERIC は pg が文字列で返すので数値に戻します。 */
function toReview(r: ReviewRow): ReviewRecord & { fault: string; fault_reason: string } {
  return {
    decision_id: r.decision_id,
    staff_id: r.staff_id,
    action: r.action as ReviewRecord["action"],
    score: r.score,
    comment: r.comment,
    ai_body: r.ai_body,
    sent_body: r.sent_body,
    diff_ratio: Number(r.diff_ratio),
    reviewed_at: r.reviewed_at.toISOString(),
    decision_ok: r.decision_ok,
    corrected_next_action: r.corrected_next_action as never,
    corrected_recipient: r.corrected_recipient as never,
    fault: r.fault,
    fault_reason: r.fault_reason,
  };
}

/** ④の入力。まだ分析していないレビューを古い順に取ります。 */
export async function unanalyzedReviews(
  staffId: string,
  limit = 50,
): Promise<Array<ReviewRecord & { fault: string; fault_reason: string }>> {
  const rows = await query<ReviewRow>(
    `SELECT * FROM reviews
      WHERE staff_id = $1 AND analyzed_at IS NULL
      ORDER BY reviewed_at ASC
      LIMIT $2`,
    [staffId, limit],
  );
  return rows.map(toReview);
}

export async function unanalyzedCount(staffId: string): Promise<number> {
  const r = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM reviews WHERE staff_id = $1 AND analyzed_at IS NULL`,
    [staffId],
  );
  return Number(r?.c ?? 0);
}

export async function markAnalyzed(decisionIds: string[]): Promise<void> {
  if (decisionIds.length === 0) return;
  await query(
    `UPDATE reviews SET analyzed_at = now() WHERE decision_id = ANY($1::uuid[])`,
    [decisionIds],
  );
}

export async function staffIdsWithReviews(): Promise<string[]> {
  const rows = await query<{ staff_id: string }>(
    `SELECT DISTINCT staff_id FROM reviews ORDER BY staff_id`,
  );
  return rows.map((r) => r.staff_id);
}

/**
 * 対象のレビュー群が、どのプロンプト版で生成されたものかを集計します。
 *
 * 2つ以上返ってきたら、そのバッチはプロンプト変更をまたいでいます。
 * ④がそのまま学習すると、プロンプト変更による文体の変化を
 * コーディネーター個人の癖として覚えてしまいます。
 */
export async function promptVersionsFor(
  decisionIds: string[],
): Promise<Array<{ prompt_id: string | null; prompt_version: string | null; count: number }>> {
  if (decisionIds.length === 0) return [];
  const rows = await query<{
    prompt_id: string | null;
    prompt_version: string | null;
    count: string;
  }>(
    `SELECT prompt_id, prompt_version, COUNT(*)::text AS count
       FROM runs
      WHERE decision_id = ANY($1::uuid[])
      GROUP BY prompt_id, prompt_version
      ORDER BY COUNT(*) DESC`,
    [decisionIds],
  );
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

/** §7 の指標。プロンプト版ごとに分けて出します。 */
export async function metricsByPromptVersion(staffId?: string): Promise<
  Array<{
    prompt_version: string | null;
    model: string | null;
    reviews: number;
    approve_rate: number | null;
    diff_ratio_avg: number | null;
    judgment_fault_rate: number | null;
    generation_fault_rate: number | null;
    last_reviewed_at: string | null;
  }>
> {
  const rows = await query<Record<string, string | null>>(
    `SELECT prompt_version, model, reviews, approve_rate, diff_ratio_avg,
            judgment_fault_rate, generation_fault_rate, last_reviewed_at
       FROM metrics_by_prompt_version
      WHERE ($1::text IS NULL OR staff_id = $1)
      ORDER BY last_reviewed_at DESC NULLS LAST`,
    [staffId ?? null],
  );
  return rows.map((r) => ({
    prompt_version: r.prompt_version,
    model: r.model,
    reviews: Number(r.reviews ?? 0),
    approve_rate: r.approve_rate === null ? null : Number(r.approve_rate),
    diff_ratio_avg: r.diff_ratio_avg === null ? null : Number(r.diff_ratio_avg),
    judgment_fault_rate:
      r.judgment_fault_rate === null ? null : Number(r.judgment_fault_rate),
    generation_fault_rate:
      r.generation_fault_rate === null ? null : Number(r.generation_fault_rate),
    last_reviewed_at: r.last_reviewed_at,
  }));
}

/** 三井さんへの受け渡し口（④の入力／分析用） */
export async function exportReviews(limit = 500): Promise<unknown[]> {
  return query(
    `SELECT rv.decision_id, rv.staff_id, rv.action, rv.score, rv.comment,
            rv.ai_body, rv.sent_body, rv.diff_ratio, rv.fault, rv.fault_reason,
            rv.decision_ok, rv.corrected_next_action, rv.corrected_recipient,
            rv.reviewed_at, rv.analyzed_at,
            r.ticket_id, r.deal_id, r.prompt_id, r.prompt_version, r.model,
            r.decision
       FROM reviews rv
       JOIN runs r ON r.decision_id = rv.decision_id
      ORDER BY rv.reviewed_at DESC
      LIMIT $1`,
    [limit],
  );
}

/* ─── メモリ ─────────────────────────────── */

export async function getMemory(staffId: string): Promise<StaffMemory> {
  const row = await queryOne<{ version: number; data: StaffMemory; updated_at: Date }>(
    `SELECT version, data, updated_at FROM memories WHERE staff_id = $1`,
    [staffId],
  );
  if (!row) return emptyMemory(staffId);
  return {
    ...row.data,
    staff_id: staffId,
    version: row.version,
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * version を上げて保存し、履歴も残します。
 * §3-5「AIが提案 → 本人が承認」の承認側です。AIからは呼びません。
 */
export async function saveMemory(
  mem: StaffMemory,
  proposalId: string | null,
): Promise<StaffMemory> {
  const next: StaffMemory = {
    ...mem,
    version: mem.version + 1,
    updated_at: new Date().toISOString(),
  };
  await tx(async (c) => {
    await c.query(
      `INSERT INTO memories (staff_id, version, data, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (staff_id) DO UPDATE
         SET version = EXCLUDED.version,
             data = EXCLUDED.data,
             updated_at = now()`,
      [next.staff_id, next.version, JSON.stringify(next)],
    );
    await c.query(
      `INSERT INTO memory_versions (staff_id, version, data, proposal_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (staff_id, version) DO NOTHING`,
      [next.staff_id, next.version, JSON.stringify(next), proposalId],
    );
  });
  return next;
}

export async function memoryHistory(
  staffId: string,
): Promise<Array<{ version: number; proposal_id: string | null; created_at: string }>> {
  const rows = await query<{ version: number; proposal_id: string | null; created_at: Date }>(
    `SELECT version, proposal_id, created_at
       FROM memory_versions WHERE staff_id = $1
      ORDER BY version DESC LIMIT 20`,
    [staffId],
  );
  return rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
}

/* ─── 提案 ───────────────────────────────── */

interface ProposalRow {
  proposal_id: string;
  staff_id: string;
  type: string;
  target: string;
  target_rule_id: string | null;
  rule: unknown;
  evidence: unknown;
  note: string;
  status: string;
  created_at: Date;
  decided_at: Date | null;
}

function toProposal(r: ProposalRow): MemoryProposal {
  return {
    proposal_id: r.proposal_id,
    staff_id: r.staff_id,
    type: r.type as MemoryProposal["type"],
    target: r.target as MemoryProposal["target"],
    target_rule_id: r.target_rule_id,
    rule: r.rule as MemoryProposal["rule"],
    evidence: (r.evidence ?? []) as MemoryProposal["evidence"],
    note: r.note,
    status: r.status as ProposalStatus,
    created_at: r.created_at.toISOString(),
    decided_at: r.decided_at ? r.decided_at.toISOString() : null,
  };
}

export async function insertProposals(list: MemoryProposal[]): Promise<void> {
  if (list.length === 0) return;
  await tx(async (c) => {
    for (const p of list) {
      await c.query(
        `INSERT INTO proposals
           (staff_id, type, target, target_rule_id, rule, evidence, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
        [
          p.staff_id,
          p.type,
          p.target,
          p.target_rule_id,
          p.rule ? JSON.stringify(p.rule) : null,
          JSON.stringify(p.evidence),
          p.note,
        ],
      );
    }
  });
}

export async function listProposals(
  status: ProposalStatus | "all" = "pending",
  staffId?: string,
): Promise<MemoryProposal[]> {
  const rows = await query<ProposalRow>(
    `SELECT * FROM proposals
      WHERE ($1::text = 'all' OR status = $1)
        AND ($2::text IS NULL OR staff_id = $2)
      ORDER BY created_at DESC
      LIMIT 200`,
    [status, staffId ?? null],
  );
  return rows.map(toProposal);
}

export async function getProposal(id: string): Promise<MemoryProposal | null> {
  const r = await queryOne<ProposalRow>(
    `SELECT * FROM proposals WHERE proposal_id = $1`,
    [id],
  );
  return r ? toProposal(r) : null;
}

export async function setProposalStatus(
  id: string,
  status: ProposalStatus,
): Promise<void> {
  await query(
    `UPDATE proposals SET status = $2, decided_at = now() WHERE proposal_id = $1`,
    [id, status],
  );
}

/* ─── ルール使用実績 ───────────────────────── */

export async function ruleUsage(staffId: string): Promise<Map<string, number>> {
  const rows = await query<{ rule_id: string; hits: number }>(
    `SELECT rule_id, hits FROM rule_usage WHERE staff_id = $1`,
    [staffId],
  );
  return new Map(rows.map((r) => [r.rule_id, r.hits]));
}

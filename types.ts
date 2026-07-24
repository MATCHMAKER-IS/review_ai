/**
 * CLAUDE.md §3 データ契約 ＋ ④レビュー学習AI の型
 *
 * §3-1〜3-5 は凍結された契約。大山さんの承認なしに変更しない。
 * Proposal 系は §3 に定義がない ④ の内部データなので、福井の裁量で決めてよい。
 */

export const NEXT_ACTIONS = [
  "男性へ候補日を転送",
  "女性へ男性オファーを転送",
  "日程確定の連絡",
  "追加情報のヒアリング",
  "保留",
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const RECIPIENTS = ["男性", "女性"] as const;
export type Recipient = (typeof RECIPIENTS)[number];

export interface Decision {
  schema_version: string;
  decision_id: string;
  situation: string;
  next_action: NextAction;
  recipient: Recipient | null;
  confidence: number;
  facts_used: Record<string, unknown>;
  field_updates: Array<{ api_name: string; value: string }>;
  escalate: boolean;
  escalate_reason: string | null;
  rationale: string;
}

export interface Draft {
  decision_id: string;
  channel: string;
  subject: string | null;
  body: string;
  used_memory_rules: string[];
  warnings: string[];
}

export type ReviewAction = "approve" | "edit" | "reject";

/** §3-4 */
export interface ReviewRecord {
  decision_id: string;
  staff_id: string;
  action: ReviewAction;
  score: number | null;
  comment: string | null;
  ai_body: string;
  sent_body: string;
  diff_ratio: number;
  reviewed_at: string;
  /** §3-4 への追加提案分。大山さんの承認待ち。null でも ④ は動く。 */
  decision_ok: boolean | null;
  corrected_next_action: NextAction | null;
  corrected_recipient: Recipient | null;
}

/* ────────────────────────────────────────────
 * §3-5 スタッフ個別メモリ
 * ──────────────────────────────────────────── */

export interface JudgmentRule {
  /** J-001 形式 */
  id: string;
  when: string;
  then: string;
  source_review: string;
  created_at: string;
}

export interface StyleRule {
  /** S-001 形式 */
  id: string;
  rule: string;
  example_before: string;
  example_after: string;
  source_review?: string;
  created_at?: string;
}

export interface StaffMemory {
  staff_id: string;
  version: number;
  judgment_rules: JudgmentRule[];
  style_rules: StyleRule[];
  ng_list: string[];
  updated_at: string;
}

export function emptyMemory(staffId: string): StaffMemory {
  return {
    staff_id: staffId,
    version: 0,
    judgment_rules: [],
    style_rules: [],
    ng_list: [],
    updated_at: new Date().toISOString(),
  };
}

/* ────────────────────────────────────────────
 * ④ レビュー学習AI の出力
 * ──────────────────────────────────────────── */

/** 誤りの帰属（§7 切り分けの原則） */
export type FaultKind =
  /** 宛先・アクションが違う */
  | "judgment"
  /** 宛先とアクションは合っているが文面が違う */
  | "generation"
  /** 無修正。学習不要だが、正解データとして数える */
  | "none"
  /** 判定できない。decision_ok が無く diff からも読めない */
  | "unknown";

export type ProposalType =
  /** 新しいルールを足す */
  | "add"
  /** 既存ルールを言い換え・強化する */
  | "update"
  /** 使われていないルールを引退させる（上限対策） */
  | "retire"
  /** 既存ルールと矛盾する。人間に選ばせる */
  | "conflict";

export type ProposalTarget = "judgment_rules" | "style_rules" | "ng_list";

export type ProposalStatus = "pending" | "approved" | "rejected";

export interface ProposalEvidence {
  decision_id: string;
  /** なぜこの提案が出たかを本人が5秒で判断できる分量に切る */
  ai_excerpt: string;
  sent_excerpt: string;
  comment: string | null;
}

export interface MemoryProposal {
  proposal_id: string;
  staff_id: string;
  type: ProposalType;
  target: ProposalTarget;
  /** update / retire / conflict のとき、対象の既存ルールID */
  target_rule_id: string | null;
  /** add / update のときの新ルール本体。retire では null */
  rule: JudgmentRule | StyleRule | { phrase: string } | null;
  /** 本人が承認判断するための根拠。これが無い提案は出さない */
  evidence: ProposalEvidence[];
  /** 「5件中4件で同じ修正」のような一言 */
  note: string;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
}

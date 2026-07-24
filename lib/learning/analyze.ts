/**
 * ④ レビュー学習AI 本体（PostgreSQL版）
 *
 * 流れ：
 *   未分析レビューを集める
 *     → 保存済みの fault で分類（§7の切り分けは書き込み時に確定済み）
 *     → 件数が閾値に満たなければ何もしない
 *     → 判断ミス群・生成ミス群をまとめてLLMに渡し、共通パターンを言語化させる
 *     → 出現回数の閾値を満たすものだけを提案に変換
 *     → 上限が近ければ引退提案も足す
 *     → 保存（適用はしない。§3-5「AIが提案 → 本人が承認」／§5 自動適用はPhase2）
 *
 * SQLite版との違い：
 *   切り分け（classify）を再実行しません。/api/reviews が書き込み時に
 *   確定させた reviews.fault をそのまま使います。判定はルールベースで
 *   決定的なので、同じ入力から二度計算する理由がありません。
 */

import {
  getMemory,
  insertProposals,
  markAnalyzed,
  promptVersionsFor,
  ruleUsage,
  unanalyzedReviews,
} from "../db";
import { chatJson } from "../openai";
import { excerpt } from "./classify";
import type { Classified } from "./classify";
import { analysisPrompt } from "./prompts";
import type {
  MemoryProposal,
  ProposalEvidence,
  ProposalType,
  ReviewRecord,
  StaffMemory,
} from "../types";

const MIN_REVIEWS = Number(process.env.LEARN_MIN_REVIEWS ?? 5);
const MIN_OCCURRENCES = Number(process.env.LEARN_MIN_OCCURRENCES ?? 2);
const MAX_JUDGMENT = Number(process.env.LEARN_MAX_JUDGMENT_RULES ?? 30);
const MAX_STYLE = Number(process.env.LEARN_MAX_STYLE_RULES ?? 30);

interface Finding {
  when?: string;
  then?: string;
  rule?: string;
  example_before?: string;
  example_after?: string;
  phrase?: string;
  evidence_ids?: string[];
  duplicates?: string | null;
  conflicts?: string | null;
}

interface FindingsResponse {
  judgment_findings?: Finding[];
  style_findings?: Finding[];
  ng_findings?: Finding[];
}

export interface AnalyzeResult {
  staff_id: string;
  status: "skipped" | "analyzed";
  reason?: string;
  reviewed: number;
  counts: { judgment: number; generation: number; unknown: number; clean: number };
  prompt_versions: Array<{
    prompt_id: string | null;
    prompt_version: string | null;
    count: number;
  }>;
  version_warning: string | null;
  proposals: number;
}

type StoredReview = ReviewRecord & { fault: string; fault_reason: string };

export async function analyzeStaff(staffId: string): Promise<AnalyzeResult> {
  const reviews = await unanalyzedReviews(staffId);

  const wrap = (r: StoredReview): Classified => ({
    review: r,
    fault: r.fault as Classified["fault"],
    reason: r.fault_reason,
  });

  const classified = reviews.map(wrap);
  const judgment = classified.filter((c) => c.fault === "judgment");
  const generation = classified.filter((c) => c.fault === "generation");
  const counts = {
    judgment: judgment.length,
    generation: generation.length,
    unknown: classified.filter((c) => c.fault === "unknown").length,
    clean: classified.filter((c) => c.fault === "none").length,
  };

  const versions = await promptVersionsFor(reviews.map((r) => r.decision_id));

  // プロンプトが変われば、AIの文体もアクションの選び方も変わります。
  // 版をまたいだレビューをまとめて学習させると、プロンプト変更による
  // 変化をコーディネーター個人の癖として覚えてしまいます。
  const versionWarning =
    versions.length > 1
      ? `このバッチはプロンプト ${versions
          .map((v) => `v${v.prompt_version ?? "不明"}(${v.count}件)`)
          .join(" / ")} をまたいでいます。` +
        "版が変わった前後で文体が変わっている可能性があるため、提案の採否は慎重に判断してください。"
      : null;

  const base = {
    staff_id: staffId,
    reviewed: reviews.length,
    counts,
    prompt_versions: versions,
    version_warning: versionWarning,
  };

  if (reviews.length < MIN_REVIEWS) {
    return {
      ...base,
      status: "skipped",
      reason: `未分析レビューが${reviews.length}件。${MIN_REVIEWS}件まで待ちます（単発の修正をルール化しないため）`,
      proposals: 0,
    };
  }

  if (judgment.length + generation.length === 0) {
    await markAnalyzed(reviews.map((r) => r.decision_id));
    return {
      ...base,
      status: "analyzed",
      reason: "修正がほぼ無く、学習すべき差分がありませんでした",
      proposals: 0,
    };
  }

  const memory = await getMemory(staffId);
  const { system, user } = analysisPrompt(memory, judgment, generation);
  const raw = (await chatJson(system, user)) as FindingsResponse;

  const byId = new Map(classified.map((c) => [c.review.decision_id, c]));

  const ruleProposals: MemoryProposal[] = [
    ...toProposals(staffId, raw.judgment_findings ?? [], "judgment_rules", byId, memory),
    ...toProposals(staffId, raw.style_findings ?? [], "style_rules", byId, memory),
    ...toProposals(staffId, raw.ng_findings ?? [], "ng_list", byId, memory),
  ];

  // 引退の要否は、閾値を通過して実際に提案になった件数で判定します。
  // LLMが挙げた候補の総数で数えると、採用されない提案のために
  // 使えているルールを引退させてしまいます。
  const incoming = {
    judgment: ruleProposals.filter(
      (p) => p.target === "judgment_rules" && p.type === "add",
    ).length,
    style: ruleProposals.filter(
      (p) => p.target === "style_rules" && p.type === "add",
    ).length,
  };

  const usage = await ruleUsage(staffId);
  const proposals = [
    ...ruleProposals,
    ...retirementProposals(staffId, memory, incoming, usage),
  ];

  if (versionWarning !== null) {
    for (const p of proposals) {
      p.note = p.note + "　※プロンプト版をまたいだレビューが根拠に含まれます";
    }
  }

  await insertProposals(proposals);
  await markAnalyzed(reviews.map((r) => r.decision_id));

  return { ...base, status: "analyzed", proposals: proposals.length };
}

export async function analyzeAll(staffIds: string[]): Promise<AnalyzeResult[]> {
  const out: AnalyzeResult[] = [];
  for (const id of staffIds) {
    try {
      out.push(await analyzeStaff(id));
    } catch (err) {
      out.push({
        staff_id: id,
        status: "skipped",
        reason: err instanceof Error ? err.message : String(err),
        reviewed: 0,
        counts: { judgment: 0, generation: 0, unknown: 0, clean: 0 },
        prompt_versions: [],
        version_warning: null,
        proposals: 0,
      });
    }
  }
  return out;
}

/* ─── 変換 ───────────────────────────────── */

function nextRuleId(prefix: "J" | "S", memory: StaffMemory): number {
  const ids =
    prefix === "J"
      ? memory.judgment_rules.map((r) => r.id)
      : memory.style_rules.map((r) => r.id);
  const max = ids.reduce((m, id) => {
    const n = Number(id.split("-")[1]);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return max + 1;
}

function toProposals(
  staffId: string,
  findings: Finding[],
  target: MemoryProposal["target"],
  byId: Map<string, Classified>,
  memory: StaffMemory,
): MemoryProposal[] {
  const out: MemoryProposal[] = [];
  let seqJ = nextRuleId("J", memory);
  let seqS = nextRuleId("S", memory);
  const ts = new Date().toISOString();

  for (const f of findings) {
    const ids = (f.evidence_ids ?? []).filter((id) => byId.has(id));

    // 出現回数の下限。ここがこのファイルで一番重要な行です。
    // これを外すと、レビュー1件につきルール1件が生まれてメモリが即死します。
    if (ids.length < MIN_OCCURRENCES) continue;

    const evidence: ProposalEvidence[] = ids.map((id) => {
      const c = byId.get(id)!;
      return {
        decision_id: id,
        ai_excerpt: excerpt(c.review.ai_body),
        sent_excerpt: excerpt(c.review.sent_body),
        comment: c.review.comment,
      };
    });

    let type: ProposalType = "add";
    let targetRuleId: string | null = null;
    if (f.conflicts) {
      type = "conflict";
      targetRuleId = f.conflicts;
    } else if (f.duplicates) {
      type = "update";
      targetRuleId = f.duplicates;
    }

    let rule: MemoryProposal["rule"] = null;
    if (target === "judgment_rules") {
      if (!f.when || !f.then) continue;
      rule = {
        id: targetRuleId ?? `J-${String(seqJ++).padStart(3, "0")}`,
        when: f.when,
        then: f.then,
        source_review: ids[0] ?? "",
        created_at: ts,
      };
    } else if (target === "style_rules") {
      if (!f.rule) continue;
      rule = {
        id: targetRuleId ?? `S-${String(seqS++).padStart(3, "0")}`,
        rule: f.rule,
        example_before: f.example_before ?? "",
        example_after: f.example_after ?? "",
        source_review: ids[0] ?? "",
        created_at: ts,
      };
    } else {
      if (!f.phrase) continue;
      rule = { phrase: f.phrase };
    }

    out.push({
      proposal_id: "",
      staff_id: staffId,
      type,
      target,
      target_rule_id: targetRuleId,
      rule,
      evidence,
      note:
        type === "conflict"
          ? `既存ルール ${targetRuleId} と矛盾します。どちらを残すか選んでください（根拠${ids.length}件）`
          : type === "update"
            ? `既存ルール ${targetRuleId} と同じ趣旨です。言い換えて上書きします（根拠${ids.length}件）`
            : `${ids.length}件のレビューに共通して現れました`,
      status: "pending",
      created_at: ts,
      decided_at: null,
    });
  }

  return out;
}

/**
 * §3-5 の30件上限対策。
 * 追加提案を全部飲むと上限を超える場合に限り、使われていないルールの
 * 引退を提案します。Draft の used_memory_rules を根拠にするので、
 * 「一度も適用されたことがないルール」から順に候補になります。
 */
function retirementProposals(
  staffId: string,
  memory: StaffMemory,
  incoming: { judgment: number; style: number },
  usage: Map<string, number>,
): MemoryProposal[] {
  const ts = new Date().toISOString();
  const out: MemoryProposal[] = [];

  const plan = [
    {
      rules: memory.judgment_rules.map((r) => ({
        id: r.id,
        label: `「${r.when}」→「${r.then}」`,
      })),
      max: MAX_JUDGMENT,
      incoming: incoming.judgment,
      target: "judgment_rules" as const,
    },
    {
      rules: memory.style_rules.map((r) => ({ id: r.id, label: r.rule })),
      max: MAX_STYLE,
      incoming: incoming.style,
      target: "style_rules" as const,
    },
  ];

  for (const p of plan) {
    const over = p.rules.length + p.incoming - p.max;
    if (over <= 0) continue;

    const coldest = [...p.rules]
      .sort((a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0))
      .slice(0, over);

    for (const r of coldest) {
      out.push({
        proposal_id: "",
        staff_id: staffId,
        type: "retire",
        target: p.target,
        target_rule_id: r.id,
        rule: null,
        evidence: [],
        note: `上限${p.max}件に達するため引退候補です。適用実績 ${usage.get(r.id) ?? 0} 回。対象：${excerpt(r.label, 80)}`,
        status: "pending",
        created_at: ts,
        decided_at: null,
      });
    }
  }

  return out;
}

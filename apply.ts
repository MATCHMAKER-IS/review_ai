/**
 * 提案の適用（§3-5「AIが提案 → 本人が承認」の承認側）
 *
 * AIは絶対にここを自分で呼びません。UIの操作からのみ呼ばれます。
 * §5 のとおり、自動適用はPhase2です。
 */

import { getMemory, getProposal, saveMemory, setProposalStatus } from "../db";
import type {
  JudgmentRule,
  MemoryProposal,
  StaffMemory,
  StyleRule,
} from "../types";

export async function rejectProposal(proposalId: string): Promise<void> {
  await setProposalStatus(proposalId, "rejected");
}

export async function approveProposal(proposalId: string): Promise<{
  ok: boolean;
  message: string;
  version?: number;
}> {
  const p = await getProposal(proposalId);
  if (!p) return { ok: false, message: "提案が見つかりません" };
  if (p.status !== "pending") {
    return {
      ok: false,
      message: `この提案はすでに${p.status === "approved" ? "反映済み" : "却下済み"}です`,
    };
  }

  const before = await getMemory(p.staff_id);
  const after = applyToMemory(before, p);
  if (!after) return { ok: false, message: "この提案は適用できませんでした" };

  const saved = await saveMemory(after, p.proposal_id);
  await setProposalStatus(proposalId, "approved");
  return {
    ok: true,
    message: `メモリを v${saved.version} に更新しました`,
    version: saved.version,
  };
}

function applyToMemory(mem: StaffMemory, p: MemoryProposal): StaffMemory | null {
  const next: StaffMemory = {
    ...mem,
    judgment_rules: [...mem.judgment_rules],
    style_rules: [...mem.style_rules],
    ng_list: [...mem.ng_list],
  };

  if (p.type === "retire") {
    if (!p.target_rule_id) return null;
    if (p.target === "judgment_rules") {
      next.judgment_rules = next.judgment_rules.filter(
        (r) => r.id !== p.target_rule_id,
      );
    } else if (p.target === "style_rules") {
      next.style_rules = next.style_rules.filter((r) => r.id !== p.target_rule_id);
    } else {
      next.ng_list = next.ng_list.filter((n) => n !== p.target_rule_id);
    }
    return next;
  }

  if (!p.rule) return null;

  // conflict は「新しい方を採用して既存を置き換える」を承認の意味とします。
  // 既存を残したい場合は却下してください。UI側にもそう書いてあります。
  if (p.target === "judgment_rules") {
    const rule = p.rule as JudgmentRule;
    const i = next.judgment_rules.findIndex(
      (r) => r.id === (p.target_rule_id ?? rule.id),
    );
    if (i >= 0) next.judgment_rules[i] = { ...next.judgment_rules[i]!, ...rule };
    else next.judgment_rules.push(rule);
    return next;
  }

  if (p.target === "style_rules") {
    const rule = p.rule as StyleRule;
    const i = next.style_rules.findIndex(
      (r) => r.id === (p.target_rule_id ?? rule.id),
    );
    if (i >= 0) next.style_rules[i] = { ...next.style_rules[i]!, ...rule };
    else next.style_rules.push(rule);
    return next;
  }

  const phrase = (p.rule as { phrase: string }).phrase;
  if (!next.ng_list.includes(phrase)) next.ng_list.push(phrase);
  return next;
}

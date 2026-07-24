/**
 * 誤りの切り分け（§7）
 *
 *   宛先・アクションが違う               → judgment（判断AIのミス）
 *   宛先とアクションは合っているが文面が違う → generation（生成AIのミス）
 *   無修正                              → none
 *
 * ここは意図的に「LLMを使わない」実装にしています。
 * 帰属の判定にLLMを挟むと、④の誤りが①②の誤りと混ざって、
 * 何が悪かったのか永久に分からなくなるためです。
 * decision_ok がある限り、切り分けは推論ではなく事実になります。
 */

import type { FaultKind, ReviewRecord } from "../types";

/**
 * 帰属が不明なとき、「文面の一部修正」と「原型をとどめない書き直し」を
 * 分ける境界。前者は生成側と仮定し、後者は unknown にして人に投げる。
 * 学習するかどうかの閾値ではないので注意。
 */
const REWRITE_RATIO = Number(process.env.LEARN_REWRITE_RATIO ?? 0.6);

/**
 * 表記ゆれを落としたうえで、1文字でも変わったかを見る。
 *
 * ここを diff_ratio の閾値で判定してはいけません。
 * 「承知いたしました。」→「承知しました(^^♪」は100文字中6文字、
 * diff_ratio にすると 0.059 にしかなりませんが、
 * これはそのコーディネーターの癖そのもので、学習価値が最も高い差分です。
 * 修正の「大きさ」と「学ぶ価値」は無関係です。
 */
function changed(a: string, b: string): boolean {
  const n = (s: string) =>
    s
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.replace(/[ \t\u3000]+$/u, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  return n(a) !== n(b);
}

export interface Classified {
  review: ReviewRecord;
  fault: FaultKind;
  /** 判定の根拠。UIに出して人が検算できるようにする */
  reason: string;
}

export function classify(review: ReviewRecord): Classified {
  // reject は「そもそも送らなかった」= 判断が的外れだった可能性が高い
  if (review.action === "reject") {
    return {
      review,
      fault: "judgment",
      reason: "コーディネーターが下書きを破棄した",
    };
  }

  const edited = changed(review.ai_body, review.sent_body);

  // decision_ok が取れている場合（§3-4 の追加項目が承認された世界）
  if (review.decision_ok === false) {
    const to = review.corrected_recipient ?? "?";
    const act = review.corrected_next_action ?? "?";
    return {
      review,
      fault: "judgment",
      reason: `判断が誤りと明示された（正: ${to} へ ${act}）`,
    };
  }

  if (review.decision_ok === true) {
    if (edited) {
      return {
        review,
        fault: "generation",
        reason: `判断は正しく、文面が直された（修正量 ${review.diff_ratio}）`,
      };
    }
    return { review, fault: "none", reason: "そのまま送信された" };
  }

  // ── フォールバック：decision_ok が無い場合 ──
  // 修正の有無は分かっても、それが「宛先が違ったから全部書き直した」のか
  // 「言い回しが気に入らなかった」のかは文面からは読めません。
  // ここを推測で埋めるとメモリが濁るので、大きい書き直しは人に投げます。
  if (!edited) {
    return { review, fault: "none", reason: "そのまま送信された" };
  }
  if (review.diff_ratio >= REWRITE_RATIO) {
    return {
      review,
      fault: "unknown",
      reason: `原型をとどめない書き直し（修正量 ${review.diff_ratio}）。判断の正否が記録されていないため帰属を特定できない`,
    };
  }
  return {
    review,
    fault: "generation",
    reason: `文面の修正（修正量 ${review.diff_ratio}）。判断の正否は未記録のため生成側と仮定`,
  };
}

export interface Batch {
  staff_id: string;
  classified: Classified[];
  judgment: Classified[];
  generation: Classified[];
  unknown: Classified[];
  clean: Classified[];
}

export function buildBatch(staffId: string, reviews: ReviewRecord[]): Batch {
  const classified = reviews.map(classify);
  return {
    staff_id: staffId,
    classified,
    judgment: classified.filter((c) => c.fault === "judgment"),
    generation: classified.filter((c) => c.fault === "generation"),
    unknown: classified.filter((c) => c.fault === "unknown"),
    clean: classified.filter((c) => c.fault === "none"),
  };
}

/** 抜粋。提案画面で本人が5秒で判断できる分量に切る。 */
export function excerpt(s: string, max = 220): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * diff_ratio の算出（§3-4 / §7 修正量）
 *
 * 注意：この値は「修正の大きさ」を測る指標であって、
 * 学習の要否を決める閾値ではありません。
 * 100文字中6文字の違い（diff_ratio 0.059）でも、
 * それがコーディネーターの癖なら学習価値は最大です。
 * 判定は classify.ts の「変わったかどうか」で行います。
 */

export function normalizeBody(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 2行DPのレーベンシュタイン距離。O(n*m) 時間 / O(m) 空間。 */
export function levenshtein(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev: number[] = new Array(b.length + 1);
  let cur: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (cur[j - 1] as number) + 1,
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[b.length] as number;
}

export function diffRatio(aiBody: string, sentBody: string): number {
  const a = [...normalizeBody(aiBody)];
  const b = [...normalizeBody(sentBody)];
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  return Math.round((levenshtein(a, b) / max) * 1000) / 1000;
}

/**
 * action の自動判定。
 * 押し分けを人に委ねると「承認」ばかり押されて §7 の指標が濁ります。
 */
export function inferAction(
  aiBody: string,
  sentBody: string,
): "approve" | "edit" {
  return normalizeBody(aiBody) === normalizeBody(sentBody) ? "approve" : "edit";
}

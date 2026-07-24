/**
 * ④ の動作確認用ダミーデータ。
 *
 * 実レビューが溜まるまで ④ をテストできないと開発が詰まるので、
 * 「繰り返し現れるパターン」を意図的に仕込んであります。
 *   - 文体：冒頭の時候の挨拶を毎回削っている（2件）
 *   - 文体：させていただきますを毎回言い換えている（2件）
 *   - 判断：女性からの返信なのに男性宛てに返そうとしている（2件）
 *   - 1件しかないパターン（LEARN_MIN_OCCURRENCES で除外されるはず）
 *
 * /api/reviews を実際に叩くので、エンドポイント・diff計算・切り分け・
 * DB書き込みの経路全体が同時に検証できます。
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/seed-reviews.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.HOOK_SECRET ?? "";
const STAFF = process.argv[2] ?? "coordinator_a";

interface Seed {
  ai: string;
  sent: string;
  decision_ok: boolean;
  corrected_next_action?: string;
  corrected_recipient?: string;
  comment?: string;
  score?: number;
}

const SEEDS: Seed[] = [
  {
    ai: "いつも大変お世話になっております。日ごとに暑さが増してまいりましたが、いかがお過ごしでしょうか。\nお相手より、8/1(金)または8/2(土)でしたらお会いできるとのご返信をいただきました。\nご都合のよい日をお知らせいただけますと幸いです。",
    sent: "お世話になっております。\nお相手より、8/1(金)または8/2(土)でしたらお会いできるとのことです。\nご都合のよい日をお知らせください。",
    decision_ok: true,
    comment: "時候の挨拶は不要。もっと簡潔に。",
    score: 3,
  },
  {
    ai: "いつもお世話になっております。梅雨明けの候、ますますご清栄のこととお慶び申し上げます。\nお相手より、7/28(月)19時からでしたらご都合がつくとのことです。\nいかがでしょうか。",
    sent: "お世話になっております。\nお相手より、7/28(月)19時からでしたらご都合がつくとのことです。\nいかがでしょうか。",
    decision_ok: true,
    score: 4,
  },
  {
    ai: "平素より大変お世話になっております。\n8/5(火)の19時で確定いたしましたのでご連絡させていただきます。",
    sent: "お世話になっております。\n8/5(火)19時で確定しましたのでご連絡します。\n当日はよろしくお願いいたします。",
    decision_ok: true,
    comment: "「させていただきます」が多い。もっと素直に。",
    score: 3,
  },
  {
    ai: "お世話になっております。\nご希望の条件について、いくつか確認させていただきたい点がございます。\nお時間のあるときにご返信いただけますと幸いです。",
    sent: "お世話になっております。\nご希望の条件について、いくつか確認したい点があります。\nお時間のあるときにご返信ください。",
    decision_ok: true,
    score: 4,
  },
  {
    ai: "お世話になっております。\nお相手より8/1(金)でしたら伺えるとのご連絡をいただきました。ご都合はいかがでしょうか。",
    sent: "お世話になっております。\nご返信ありがとうございます。8/1(金)でお相手にお伝えしますので、少々お待ちください。",
    decision_ok: false,
    corrected_next_action: "女性へ男性オファーを転送",
    corrected_recipient: "女性",
    comment: "女性から返信が来た直後。まず女性に受領の返事をするべき。",
    score: 2,
  },
  {
    ai: "お世話になっております。\nお相手より8/9(土)を希望されています。ご都合はいかがでしょうか。",
    sent: "お世話になっております。\nご連絡ありがとうございます。8/9(土)でお相手に確認しますので、少しお待ちください。",
    decision_ok: false,
    corrected_next_action: "女性へ男性オファーを転送",
    corrected_recipient: "女性",
    comment: "返信をくれた側に先に一言返す。",
    score: 2,
  },
  {
    // 1件しかないパターン。閾値が効いていればルール化されない。
    ai: "お世話になっております。\n本日はご連絡ありがとうございました。",
    sent: "お世話になっております。\n本日はご連絡いただき、ありがとうございました。",
    decision_ok: true,
    score: 5,
  },
];

let n = 0;
for (const s of SEEDS) {
  const res = await fetch(`${BASE}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { "X-Api-Key": SECRET } : {}),
    },
    body: JSON.stringify({
      ticket_id: `seed-${1000 + n}`,
      staff_id: STAFF,
      ai_body: s.ai,
      sent_body: s.sent,
      prompt_id: "pmpt_seed",
      prompt_version: "3",
      model: "gpt-5.6",
      score: s.score ?? null,
      comment: s.comment ?? null,
      decision_ok: s.decision_ok,
      corrected_next_action: s.corrected_next_action ?? null,
      corrected_recipient: s.corrected_recipient ?? null,
    }),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`  NG (${res.status})`, json);
  } else {
    console.log(
      `  ${String(n + 1).padStart(2)} fault=${String(json.fault).padEnd(11)} diff=${json.diff_ratio}`,
    );
  }
  n++;
}

console.log(`\n${STAFF} に ${n} 件を投入しました。`);
console.log(`${BASE}/proposals で「振り返りを実行」を押してください。`);

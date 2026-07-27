/**
 * /api/review の動作確認用。
 *
 * ai → sent の順に POST します。
 * sent を送った時点でペアが揃い、OpenAIの判定まで走ります。
 *
 *   npm run dev            別ターミナルで起動
 *   npm run seed
 *
 * OPENAI_API_KEY と DATABASE_URL の両方が必要です。
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.HOOK_SECRET ?? "";

const PAIRS = [
  {
    ai: "藤原 達之 様\n\n19:30の誤りとのこと、承知いたしました。\n改めて確認いたします。",
    sent: "藤原 達之 様\n\n19:30の誤りとのこと、承知しました(^^♪\n改めて確認いたします。",
  },
];

async function post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SECRET ? { "X-Api-Key": SECRET } : {}),
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
}

let n = 0;
for (const p of PAIRS) {
  const ticketId = `seed-${1000 + n}`;
  console.log(`\n── ticket_id=${ticketId} ──`);

  const a = await post({
    ticket_id: ticketId,
    message: p.ai,
    type: "ai",
    staff_id: "coordinator_a",
    memory: 7,
  });
  console.log(`  ai   : ${a.status}  ${JSON.stringify(a.result ?? a)}`);

  const s = await post({
    ticket_id: ticketId,
    message: p.sent,
    type: "sent",
    staff_id: "coordinator_a",
  });
  console.log(`  sent : ${s.status}  ${JSON.stringify(s.result ?? s)}`);
  n++;
}

console.log("\n判定の中身は SELECT * FROM review_judgments; で確認できます。");

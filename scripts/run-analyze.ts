/**
 * CLIから分析を回します。画面を立ち上げずに ④ の挙動だけ見たいとき用。
 *
 *   npx tsx scripts/run-analyze.ts                全スタッフ
 *   npx tsx scripts/run-analyze.ts coordinator_a  1人だけ
 */

import { analyzeAll, analyzeStaff } from "../lib/learning/analyze";
import { listProposals, staffIdsWithReviews } from "../lib/db";
import { endPool } from "../lib/pg";

const target = process.argv[2];
const results = target
  ? [await analyzeStaff(target)]
  : await analyzeAll(await staffIdsWithReviews());

for (const r of results) {
  console.log(`\n── ${r.staff_id} ──`);
  console.log(`状態: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
  console.log(
    `切り分け: 判断ミス ${r.counts.judgment} / 生成ミス ${r.counts.generation} / 不明 ${r.counts.unknown} / 無修正 ${r.counts.clean}`,
  );
  if (r.prompt_versions.length > 0) {
    console.log(
      "プロンプト版: " +
        r.prompt_versions
          .map((v) => `v${v.prompt_version ?? "未記録"}(${v.count}件)`)
          .join(" / "),
    );
  }
  if (r.version_warning) console.log("警告: " + r.version_warning);
  console.log(`提案: ${r.proposals}件`);

  for (const p of await listProposals("pending", r.staff_id)) {
    console.log(`  [${p.type}] ${p.target} — ${p.note}`);
    if (p.rule) console.log(`    ${JSON.stringify(p.rule)}`);
  }
}

await endPool();

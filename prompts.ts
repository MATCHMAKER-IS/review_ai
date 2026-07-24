/**
 * ④ のプロンプト。
 *
 * 設計上のポイント：
 *  - 帰属の判定（判断ミスか生成ミスか）はLLMに聞きません。classify.ts で確定済み。
 *    LLMには「同じ種類の誤りが束になったもの」だけを渡し、
 *    そこから共通するパターンを言語化させる仕事だけをさせます。
 *  - 既存ルール一覧を必ず渡し、重複と矛盾を申告させます。
 *    これをやらないとメモリが§3-5の30件上限をすぐ超えます。
 *  - 1件しか根拠がないパターンも出させますが、採用するかは analyze.ts 側で
 *    出現回数の閾値によって決めます。LLMに「何件以上なら」を判断させない。
 */

import type { Classified } from "./classify";
import { excerpt } from "./classify";
import type { StaffMemory } from "../types";

const SYSTEM = `あなたは、結婚相談所のコーディネーター業務を支援するAIの「振り返り担当」です。
AIが作った下書きと、コーディネーターが実際に送った文面の差分を複数件まとめて読み、
そのコーディネーター個人に固有の傾向をルールとして言語化します。

【最重要】
- 1件だけに現れた差分は、その日の気分や案件固有の事情かもしれません。
  複数件に共通して現れたパターンを優先して抽出してください。
- 既存ルール一覧を渡します。意味が重なるものは duplicates に既存IDを書き、
  新しいルールとして重複させないでください。
- 既存ルールと逆のことを言う場合は conflicts に既存IDを書いてください。
  勝手にどちらかを選ばず、両方を人間に見せます。
- ルールは「次に同じ状況が来たらどうするか」が一意に決まる書き方にしてください。
  「丁寧にする」のような曖昧な表現は禁止です。
- 文体ルールには【必ず適用条件を書いてください】。
  差分に現れた振る舞いだけを書いて条件を省くと、生成AIはあらゆる場面でそれを実行します。
  たとえば「顔文字を時々つける」は禁止です。「時々」が判断できないからです。
  「軽い確認や受領の返信では、語尾をやわらげて顔文字を添える」のように、
  どの場面かが読み取れる形で書いてください。
- さらに、その振る舞いを【使ってはいけない場面】が想像できる場合は、
  必ず ng_findings に書き出してください。
  この会社は結婚相談所であり、日程トラブル・お断り・退会・返金・苦情への返信で
  くだけた表現を使うと重大な事故になります。
  くだけた文体のルールを1つ作ったら、その禁止場面も必ずセットで挙げてください。
- 会員の氏名・連絡先は、ルール本文にも例文にも書かないでください。

【出力】JSONオブジェクトのみ。説明文やコードフェンスを付けない。
{
  "judgment_findings": [
    { "when": "どういう状況のとき", "then": "どう判断すべきか",
      "evidence_ids": ["decision_id", ...], "duplicates": "J-001 か null", "conflicts": "J-002 か null" }
  ],
  "style_findings": [
    { "rule": "適用条件を含んだ文体ルール", "example_before": "AIが書いた例", "example_after": "実際に送られた例",
      "evidence_ids": ["decision_id", ...], "duplicates": "S-001 か null", "conflicts": "S-002 か null" }
  ],
  "ng_findings": [
    { "phrase": "使うべきでない表現、または使ってはいけない場面", "evidence_ids": ["decision_id", ...] }
  ]
}

【rule の書き方】
悪い例: "顔文字を時々つける"
        → 「時々」が判断できず、謝罪メールにも顔文字が入ります。
悪い例: "もっとフランクな文体にする"
        → どの程度かが決まりません。
良い例: "相手からの軽い確認・報告を受けたときの返信は、『いたしました』ではなく
        『しました』と短くし、語尾に顔文字を添える"
        → 場面と、実際に何を書き換えるかが両方読み取れます。`;

function renderMemory(mem: StaffMemory): string {
  const j = mem.judgment_rules
    .map((r) => `- ${r.id}: 「${r.when}」のとき「${r.then}」`)
    .join("\n");
  const s = mem.style_rules.map((r) => `- ${r.id}: ${r.rule}`).join("\n");
  const ng = mem.ng_list.map((n) => `- ${n}`).join("\n");
  return [
    `## 既存の判断ルール（${mem.judgment_rules.length}件 / 上限30）`,
    j || "（なし）",
    "",
    `## 既存の文体ルール（${mem.style_rules.length}件 / 上限30）`,
    s || "（なし）",
    "",
    "## 既存のNG表現",
    ng || "（なし）",
  ].join("\n");
}

function renderCase(c: Classified, i: number): string {
  const r = c.review;
  const head = `### 事例${i + 1}  decision_id: ${r.decision_id}`;
  const meta = [
    `切り分け: ${c.fault === "judgment" ? "判断の誤り" : "文面の誤り"}（${c.reason}）`,
    r.decision_ok === false && r.corrected_next_action
      ? `本来のアクション: ${r.corrected_recipient ?? "?"} へ ${r.corrected_next_action}`
      : null,
    r.score !== null ? `評価: ${r.score}/5` : null,
    r.comment ? `コメント: ${r.comment}` : null,
    `修正量: ${r.diff_ratio}`,
  ]
    .filter(Boolean)
    .join(" / ");

  return [
    head,
    meta,
    "",
    "【AIが作った下書き】",
    excerpt(r.ai_body, 700),
    "",
    "【実際に送られた文面】",
    excerpt(r.sent_body, 700),
  ].join("\n");
}

export function analysisPrompt(
  mem: StaffMemory,
  judgment: Classified[],
  generation: Classified[],
): { system: string; user: string } {
  const sections: string[] = [renderMemory(mem), ""];

  if (judgment.length > 0) {
    sections.push(
      `# 判断が誤っていた事例（${judgment.length}件）`,
      "ここからは judgment_findings を作ってください。",
      "",
      judgment.map(renderCase).join("\n\n"),
      "",
    );
  }
  if (generation.length > 0) {
    sections.push(
      `# 判断は正しく、文面が直された事例（${generation.length}件）`,
      "ここからは style_findings と ng_findings を作ってください。",
      "",
      generation.map(renderCase).join("\n\n"),
    );
  }

  return { system: SYSTEM, user: sections.join("\n") };
}

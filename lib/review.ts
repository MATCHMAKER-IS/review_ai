/**
 * レビュー処理（DB非依存）
 *
 * ①AIの下書きと②実際に送信された文面を比較し、
 * 差分・帰属・文体ルール候補を返します。
 *
 * このファイルは pg を一切importしません。DBが未設定でも動きます。
 *
 * 【役割分担】
 *   diff_ratio と fault（§7の切り分け）は純粋な関数で計算します。
 *   LLMには「差分からルールを言語化する」仕事だけをさせます。
 *
 *   帰属の判定にLLMを挟むと、④の誤判定が①②の誤りと混ざり、
 *   精度が上がらないときに原因を切り分けられなくなります。
 */

import { diffRatio, inferAction } from "./diff";
import { classify } from "./learning/classify";
import type { ReviewRecord } from "./types";

const API_URL = "https://api.openai.com/v1/responses";

export interface DiffItem {
  before: string;
  after: string;
  kind: string;
}

export interface StyleFinding {
  rule: string;
  applies_when: string;
  avoid_when: string;
}

export interface ReviewAnalysis {
  diffs: DiffItem[];
  substance_changed: boolean;
  generation_mistake: boolean;
  style_finding: StyleFinding;
  summary: string;
}

/**
 * エラーの共通形式。
 *
 * code は機械判定用、message は人が読む用です。
 * 呼び出し側（Deluge など）が code で分岐できるようにしています。
 */
export interface ApiError {
  code:
    | "openai_key_missing"
    | "openai_error"
    | "openai_timeout"
    | "openai_bad_response";
  message: string;
  detail?: string;
}

export interface ReviewResult {
  /** 機械的に決まる部分。LLMを介しません */
  deterministic: {
    action: "approve" | "edit";
    diff_ratio: number;
    fault: string;
    fault_reason: string;
  };
  /** LLMが言語化した部分 */
  analysis: ReviewAnalysis | null;
  /** OpenAI から受信したレスポンス全文（監査・再現用）。呼ばなかった場合は null */
  raw: unknown | null;
  /** 再現・比較のために残す版情報 */
  versions: {
    response_id: string | null;
    model_requested: string;
    model_resolved: string | null;
    review_prompt_version: string;
    generated_prompt_version: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
  };
  error: ApiError | null;
}

/**
 * このプロンプトを書き換えたら必ず上げてください。
 * Managed Prompt は廃止予定のため、版管理は自前で持ちます。
 */
export const REVIEW_PROMPT_VERSION = "2.4.0";

const INSTRUCTIONS = [
  "あなたは男女のマッチングのコーディネーター業務を支援するAIの振り返り担当です。",
  "AIが作成した下書き①と、コーディネーターが実際に送信した文面②を比較し、",
  "何がどう書き換えられたかを抽出してください。",
  "",
  "【差分の抽出】",
  "- 変更された箇所が複数ある場合は、すべてを diffs 配列に列挙してください。",
  "  1箇所だけに絞らないこと。語尾・敬語・顔文字・句読点・語順など、",
  "  種類が違えば別の要素として分けて挙げてください。",
  "- before は①の該当箇所、after は②の該当箇所。追加された表現は",
  "  before を空文字、削除された表現は after を空文字にしてください。",
  "- 変更のあった箇所は、その文の区切り（句点「。」や読点「、」）まで",
  "  含めた一続きの単位で抽出してください。語尾だけを途中で切らず、",
  "  文として意味の通る範囲で before / after を作ります。",
  "  例: ①「承知いたしました。」→ ②「承知しました(^^♪」のように、",
  "  句点を含めて対応させる。変更に関係のない他の文の句読点は含めません。",
  "- 変更が無ければ diffs は空配列にしてください。",
  "- 次の2種類の固有名詞の違いは、差分に含めないでください。",
  "  文体の癖ではなく、単なる差し替えだからです。",
  "  diffs に入れず、変更の件数にも数えないでください。",
  "  (a) 担当者（差出人）の氏名・署名。",
  "      担当者の引き継ぎで差出人が変わることがあります。",
  "      例: 署名が『小林 麻依』→『田中 太郎』でも差分にしない。",
  "  (b) 宛名（相手のお客様・会員の氏名）。",
  "      同じ文面を別の会員宛に差し替えて使うことがあります。",
  "      例: 宛名が『藤原 達之 様』→『山田 花子 様』でも差分にしない。",
  "  文末表現・敬語・顔文字・語順など、氏名以外の変更は",
  "  これまでどおり通常どおり抽出してください。",
  "",
  "【判定の指針】",
  "- substance_changed は、宛先・伝えている事実・依頼内容が変わったかどうか。",
  "  言い回しだけが変わった場合は false。内容そのものが変わった場合は true。",
  "- generation_mistake は、文面に手が入っていれば true。",
  "- 判断AI（宛先とアクションを決めるAI）の正否は、この2つの文面だけからは",
  "  決められません。推測して書かないでください。",
  "- 修正が小さくても軽視しないこと。語尾ひとつの違いが、そのコーディネーター",
  "  固有の癖として最も価値のある差分であることがあります。",
  "",
  "【style_finding の書き方】",
  "差分から読み取れる文体の癖を1つにまとめ、必ず適用条件を含めてください。",
  "悪い例:「顔文字を時々つける」→「時々」が判断できず、謝罪メールにも顔文字が入ります。",
  "良い例:「相手からの軽い確認や報告に応じる返信では、語尾を『いたしました』ではなく",
  "　　　　『しました』と短くし、顔文字を添える」",
  "avoid_when には、その振る舞いを使ってはいけない場面を必ず書いてください。",
  "日程トラブル・お断り・退会・返金・苦情への返信でくだけた表現を使うと",
  "重大な事故になります。",
  "",
  "会員の氏名・連絡先は、ルール本文にも例文にも書かないでください。",
  "",
  "【出力】次の形のJSONオブジェクトのみを返してください。",
  JSON.stringify(
    {
      diffs: [
        { before: "承知いたしました。", after: "承知しました(^^♪", kind: "文末表現" },
        { before: "別の該当箇所（句読点まで）", after: "変更後", kind: "敬語 など" },
      ],
      substance_changed: false,
      generation_mistake: true,
      style_finding: { rule: "", applies_when: "", avoid_when: "" },
      summary: "一文で要約",
    },
    null,
    2,
  ),
].join("\n");

function validate(raw: unknown): ReviewAnalysis | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const sf = (o.style_finding ?? {}) as Record<string, unknown>;
  const diffs = Array.isArray(o.diffs) ? o.diffs : [];

  return {
    diffs: diffs
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map((d) => ({
        before: String(d.before ?? ""),
        after: String(d.after ?? ""),
        kind: String(d.kind ?? ""),
      })),
    substance_changed: o.substance_changed === true,
    generation_mistake: o.generation_mistake === true,
    style_finding: {
      rule: String(sf.rule ?? ""),
      applies_when: String(sf.applies_when ?? ""),
      avoid_when: String(sf.avoid_when ?? ""),
    },
    summary: String(o.summary ?? ""),
  };
}

export async function reviewPair(args: {
  ai_body: string;
  sent_body: string;
  generated_prompt_version?: string | null;
  model?: string;
}): Promise<ReviewResult> {
  const model = args.model ?? process.env.OPENAI_MODEL ?? "gpt-5.6";

  // ── 機械的に決まる部分（LLM不要）──────────
  const ratio = diffRatio(args.ai_body, args.sent_body);
  const action = inferAction(args.ai_body, args.sent_body);
  const provisional: ReviewRecord = {
    decision_id: "",
    staff_id: "",
    action,
    score: null,
    comment: null,
    ai_body: args.ai_body,
    sent_body: args.sent_body,
    diff_ratio: ratio,
    reviewed_at: new Date().toISOString(),
    decision_ok: null,
    corrected_next_action: null,
    corrected_recipient: null,
  };
  const classified = classify(provisional);

  const base: ReviewResult = {
    deterministic: {
      action,
      diff_ratio: ratio,
      fault: classified.fault,
      fault_reason: classified.reason,
    },
    analysis: null,
    raw: null,
    versions: {
      response_id: null,
      model_requested: model,
      model_resolved: null,
      review_prompt_version: REVIEW_PROMPT_VERSION,
      generated_prompt_version: args.generated_prompt_version ?? null,
      input_tokens: null,
      output_tokens: null,
    },
    error: null,
  };

  // 無修正ならLLMを呼びません。学習すべき差分がないためです。
  if (action === "approve") {
    return { ...base, error: null };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ...base,
      error: {
        code: "openai_key_missing",
        message: "OPENAI_API_KEY が未設定です",
      },
    };
  }

  // 末尾の1行は必須です。text.format が json_object のとき、OpenAI は
  // instructions ではなく input の中に "json" という語があるかを見ます。
  // これが無いと「input messages must contain the word 'json'」で弾かれます。
  const userInput = [
    "# ① AIが作成した下書き",
    args.ai_body,
    "",
    "# ② 実際に送信された文面",
    args.sent_body,
    "",
    "上記2つを比較し、指定されたキー構成の json オブジェクトのみを返してください。",
  ].join("\n");

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000),
  );

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: INSTRUCTIONS,
        input: userInput,
        text: { format: { type: "json_object" } },
        max_output_tokens: 2000,
        // temperature は指定しません。gpt-5系（推論モデル）が受け付けません。
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok || data.error) {
      const e = data.error as { message?: string } | undefined;
      return {
        ...base,
        raw: data,
        error: {
          code: "openai_error",
          message: e?.message ?? `OpenAI が ${res.status} を返しました`,
          detail: `HTTP ${res.status}`,
        },
      };
    }

    // output配列にはツール呼び出しや推論トークンも入りうるため、
    // output[0].content[0].text を決め打ちしません。
    let text = "";
    const output = Array.isArray(data.output) ? data.output : [];
    for (const item of output as Array<Record<string, unknown>>) {
      if (item.type !== "message") continue;
      const content = Array.isArray(item.content) ? item.content : [];
      for (const c of content as Array<Record<string, unknown>>) {
        if (c.type === "output_text" && typeof c.text === "string") text = c.text;
      }
    }

    const usage = data.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;

    const versions = {
      ...base.versions,
      response_id: typeof data.id === "string" ? data.id : null,
      model_resolved: typeof data.model === "string" ? data.model : null,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    };

    if (!text) {
      return {
        ...base,
        versions,
        error: {
          code: "openai_bad_response",
          message: "レスポンスにテキスト出力が含まれていませんでした",
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ...base,
        versions,
        error: {
          code: "openai_bad_response",
          message: "OpenAIの出力をJSONとして解釈できませんでした",
          detail: text.slice(0, 200),
        },
      };
    }

    return { ...base, versions, analysis: validate(parsed), raw: data, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const aborted = msg.includes("abort") || msg.includes("Abort");
    return {
      ...base,
      error: aborted
        ? {
            code: "openai_timeout",
            message: "OpenAIへのリクエストがタイムアウトしました",
          }
        : { code: "openai_error", message: msg },
    };
  } finally {
    clearTimeout(timer);
  }
}

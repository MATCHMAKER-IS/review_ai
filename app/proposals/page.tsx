import {
  getMemory,
  listProposals,
  metricsByPromptVersion,
  staffIdsWithReviews,
  unanalyzedCount,
} from "@/lib/db";
import type { CSSProperties } from "react";
import type { JudgmentRule, MemoryProposal, StyleRule } from "@/lib/types";
import { analyzeAction, approveAction, rejectAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<MemoryProposal["type"], string> = {
  add: "新しいルール",
  update: "既存ルールの言い換え",
  conflict: "既存ルールと矛盾",
  retire: "引退の提案",
};

const TARGET_LABEL: Record<MemoryProposal["target"], string> = {
  judgment_rules: "判断ルール",
  style_rules: "文体ルール",
  ng_list: "NG表現",
};

function ruleHeadline(p: MemoryProposal): string {
  if (p.type === "retire") return `${p.target_rule_id} を削除する`;
  if (!p.rule) return "（内容なし）";
  if (p.target === "judgment_rules") {
    const r = p.rule as JudgmentRule;
    return `「${r.when}」のときは「${r.then}」`;
  }
  if (p.target === "style_rules") return (p.rule as StyleRule).rule;
  return `「${(p.rule as { phrase: string }).phrase}」は使わない`;
}

const th: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  borderBottom: "1px solid var(--rule)",
  fontSize: 12,
  color: "var(--muted)",
};
const td: CSSProperties = {
  padding: "7px 8px",
  borderBottom: "1px solid var(--rule)",
};

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const sp = await searchParams;

  // DBに繋がらない・テーブルが無い場合、そのまま投げると本番では
  // Digest だけが表示されて原因が分かりません。ここで捕まえて
  // 実際のエラーメッセージと対処法を画面に出します。
  let staffIds: string[];
  let pending: Awaited<ReturnType<typeof listProposals>>;
  let memory: Awaited<ReturnType<typeof getMemory>>;
  let waiting: number;
  let byVersion: Awaited<ReturnType<typeof metricsByPromptVersion>>;
  let staffId: string;

  try {
    staffIds = await staffIdsWithReviews();
    staffId = sp.staff ?? staffIds[0] ?? "coordinator_a";
    [pending, memory, waiting, byVersion] = await Promise.all([
      listProposals("pending", staffId),
      getMemory(staffId),
      unanalyzedCount(staffId),
      metricsByPromptVersion(staffId),
    ]);
  } catch (err) {
    return <SetupError error={err} />;
  }

  const minReviews = Number(process.env.LEARN_MIN_REVIEWS ?? 5);
  const pct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v * 100)}%`;

  return (
    <main>
      <div className="card">
        <h2>担当</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {staffIds.length === 0 && (
            <span className="note">レビューがまだありません</span>
          )}
          {staffIds.map((id) => (
            <a
              key={id}
              href={`/proposals?staff=${encodeURIComponent(id)}`}
              className="mono"
              style={{
                padding: "5px 11px",
                borderRadius: 4,
                textDecoration: "none",
                background: id === staffId ? "var(--ink)" : "#fff",
                color: id === staffId ? "#fff" : "var(--ink)",
                border: "1px solid var(--rule)",
              }}
            >
              {id}
            </a>
          ))}
        </div>

        <div className="stats">
          <div>
            <div className="n">v{memory.version}</div>
            <div className="l">メモリ版数</div>
          </div>
          <div>
            <div className="n">
              {memory.judgment_rules.length}
              <span style={{ fontSize: 13, color: "var(--muted)" }}>/30</span>
            </div>
            <div className="l">判断ルール</div>
          </div>
          <div>
            <div className="n">
              {memory.style_rules.length}
              <span style={{ fontSize: 13, color: "var(--muted)" }}>/30</span>
            </div>
            <div className="l">文体ルール</div>
          </div>
          <div>
            <div className="n">{waiting}</div>
            <div className="l">未分析レビュー</div>
          </div>
        </div>

        <form action={analyzeAction} className="acts">
          <input type="hidden" name="staff_id" value={staffId} />
          <button className="ok" type="submit" disabled={waiting < minReviews}>
            振り返りを実行
          </button>
          <span className="hint">
            {waiting < minReviews
              ? `未分析レビューが${minReviews}件たまると実行できます（あと${minReviews - waiting}件）。単発の修正をルールにしないための下限です。`
              : `${waiting}件のレビューをまとめて分析し、共通するパターンだけを提案します。`}
          </span>
        </form>
      </div>

      {pending.length === 0 ? (
        <div className="card">
          <div className="empty">
            承認待ちの提案はありません。
            <br />
            レビューが溜まったら「振り返りを実行」を押してください。
          </div>
        </div>
      ) : (
        pending.map((p) => (
          <div className="card" key={p.proposal_id}>
            <span className={`kind ${p.type}`}>{KIND_LABEL[p.type]}</span>{" "}
            <span className="note">{TARGET_LABEL[p.target]}</span>
            <div className="rule">{ruleHeadline(p)}</div>
            <div className="note">{p.note}</div>

            {p.target === "style_rules" && p.rule && (
              <details>
                <summary>言い換えの例を見る</summary>
                <div className="evidence">
                  <div className="lbl">AIが書いた</div>
                  <p>{(p.rule as StyleRule).example_before || "（なし）"}</p>
                  <div className="lbl">こう直された</div>
                  <p>{(p.rule as StyleRule).example_after || "（なし）"}</p>
                </div>
              </details>
            )}

            {p.evidence.length > 0 && (
              <details>
                <summary>根拠になったやり取り {p.evidence.length}件</summary>
                {p.evidence.map((e) => (
                  <div className="evidence" key={e.decision_id}>
                    <div className="lbl">AIの下書き</div>
                    <p>{e.ai_excerpt}</p>
                    <div className="lbl">実際に送った文面</div>
                    <p>{e.sent_excerpt}</p>
                    {e.comment && <div className="cm">コメント：{e.comment}</div>}
                  </div>
                ))}
              </details>
            )}

            <div className="acts">
              <form action={approveAction}>
                <input type="hidden" name="proposal_id" value={p.proposal_id} />
                <button className="ok" type="submit">
                  メモリに反映
                </button>
              </form>
              <form action={rejectAction}>
                <input type="hidden" name="proposal_id" value={p.proposal_id} />
                <button className="no" type="submit">
                  見送る
                </button>
              </form>
              <span className="hint">
                {p.type === "conflict"
                  ? "反映すると既存ルールを新しい内容で置き換えます。今のルールを残したい場合は見送ってください。"
                  : "反映するとメモリの版数が上がり、次の下書きから効きます。"}
              </span>
            </div>
          </div>
        ))
      )}

      <div className="card">
        <h2>プロンプト版ごとの実績</h2>
        {byVersion.length === 0 ? (
          <p className="note" style={{ margin: 0 }}>
            まだレビューがありません。
          </p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={th}>プロンプト版</th>
                  <th style={th}>モデル</th>
                  <th style={{ ...th, textAlign: "right" }}>件数</th>
                  <th style={{ ...th, textAlign: "right" }}>無修正率</th>
                  <th style={{ ...th, textAlign: "right" }}>修正量</th>
                  <th style={{ ...th, textAlign: "right" }}>判断ミス率</th>
                </tr>
              </thead>
              <tbody>
                {byVersion.map((v) => (
                  <tr key={`${v.prompt_version}-${v.model}`}>
                    <td style={td} className="mono">
                      {v.prompt_version ?? "（未記録）"}
                    </td>
                    <td style={td} className="mono">
                      {v.model ?? "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{v.reviews}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {pct(v.approve_rate)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {v.diff_ratio_avg ?? "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {pct(v.judgment_fault_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byVersion.some((v) => v.prompt_version === null) && (
              <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>
                プロンプト版が記録されていないレビューがあります。POST時に
                prompt_version を送るようにしてください。記録が無いと、精度の変化が
                メモリによるものかプロンプト変更によるものか判別できません。
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>いまのメモリ v{memory.version}</h2>
        <p className="note" style={{ margin: "0 0 8px" }}>
          判断ルール
        </p>
        <ul className="memlist">
          {memory.judgment_rules.length === 0 && <li className="note">（なし）</li>}
          {memory.judgment_rules.map((r) => (
            <li key={r.id}>
              <span className="mono">{r.id}</span> 「{r.when}」→「{r.then}」
            </li>
          ))}
        </ul>
        <p className="note" style={{ margin: "14px 0 8px" }}>
          文体ルール
        </p>
        <ul className="memlist">
          {memory.style_rules.length === 0 && <li className="note">（なし）</li>}
          {memory.style_rules.map((r) => (
            <li key={r.id}>
              <span className="mono">{r.id}</span> {r.rule}
            </li>
          ))}
        </ul>
        <p className="note" style={{ margin: "14px 0 8px" }}>
          NG表現
        </p>
        <ul className="memlist">
          {memory.ng_list.length === 0 && <li className="note">（なし）</li>}
          {memory.ng_list.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/**
 * DB未設定・未マイグレーション時の案内。
 *
 * 本番の Next.js は例外の中身を隠して Digest だけを返すため、
 * 設定ミスの切り分けが極端にやりにくくなります。
 * 想定内の失敗はここで受けて、次にやることまで書きます。
 */
function SetupError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);

  let hint = "エラーメッセージを確認してください。";
  if (message.includes("DATABASE_URL")) {
    hint =
      "Amplify コンソールの環境変数に DATABASE_URL を設定し、再デプロイしてください。環境変数の変更だけでは反映されません。";
  } else if (message.includes("does not exist") || message.includes("relation")) {
    hint =
      "スキーマが未適用です。psql \"$DATABASE_URL\" -f db/schema.sql と -f db/002_messages.sql を実行してください。";
  } else if (
    message.includes("timeout") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNREFUSED")
  ) {
    hint =
      "DBに到達できません。RDSのセキュリティグループで Lambda からの 5432 番を許可しているか、VPC設定を確認してください。";
  } else if (message.includes("password") || message.includes("authentication")) {
    hint =
      "認証に失敗しています。接続文字列のユーザー名とパスワードを確認してください。特殊文字はURLエンコードが必要です。";
  } else if (message.includes("SSL") || message.includes("pg_hba")) {
    hint =
      "SSL設定が合っていません。RDS が SSL を要求している場合、PGSSL は未設定のままにしてください。";
  }

  return (
    <main>
      <div className="card">
        <h2>データベースに接続できません</h2>
        <div className="banner warn" style={{ marginBottom: 14 }}>
          {hint}
        </div>
        <p className="note" style={{ margin: "0 0 6px" }}>
          実際のエラー
        </p>
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "var(--ground)",
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            overflowX: "auto",
          }}
        >
          {message}
        </pre>
        <p className="note" style={{ marginTop: 14, marginBottom: 0 }}>
          <a href="/api/health">/api/health</a> でDB接続だけを個別に確認できます。
        </p>
      </div>
    </main>
  );
}

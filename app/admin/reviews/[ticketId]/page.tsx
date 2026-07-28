import { getJudgment } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAULT_LABEL: Record<string, string> = {
  judgment: "判断AIのミス",
  generation: "生成AIのミス",
  none: "修正なし",
  unknown: "保留（要人手確認）",
};

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "16px 18px",
  marginBottom: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};
const label: React.CSSProperties = {
  fontSize: 12,
  color: "#78716c",
  marginBottom: 4,
};
const pre: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: 1.7,
};

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const decoded = decodeURIComponent(ticketId);

  let j;
  try {
    j = await getJudgment(decoded);
  } catch (err) {
    return (
      <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8 }}>
        <pre style={pre}>{err instanceof Error ? err.message : String(err)}</pre>
      </div>
    );
  }

  if (!j) {
    return (
      <>
        <a href="/admin/reviews" style={{ color: "#1d4ed8" }}>← 一覧へ</a>
        <p style={{ marginTop: 16 }}>
          チケット「{decoded}」の判定結果が見つかりません。
        </p>
      </>
    );
  }

  return (
    <>
      <a href="/admin/reviews" style={{ color: "#1d4ed8", textDecoration: "none" }}>
        ← 一覧へ
      </a>

      <h2 style={{ fontSize: 20, margin: "12px 0 4px" }}>{j.ticket_id}</h2>
      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 16px" }}>
        担当: {j.staff_id ?? "—"} ／ メモリ版: {j.memory_version ?? "—"} ／{" "}
        判定: {new Date(j.judged_at).toLocaleString("ja-JP")}
      </p>

      {/* サマリ */}
      <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={label}>帰属</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {FAULT_LABEL[j.fault] ?? j.fault}
          </div>
        </div>
        <div>
          <div style={label}>差分あり</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {j.has_diff ? "あり" : "なし"}
          </div>
        </div>
        <div>
          <div style={label}>修正量</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{j.diff_ratio}</div>
        </div>
        <div>
          <div style={label}>変更箇所</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{j.diff_count} 箇所</div>
        </div>
      </div>

      {j.fault_reason && (
        <div style={card}>
          <div style={label}>帰属の理由</div>
          <p style={pre}>{j.fault_reason}</p>
        </div>
      )}

      {j.diff_summary && (
        <div style={card}>
          <div style={label}>要約</div>
          <p style={pre}>{j.diff_summary}</p>
        </div>
      )}

      {/* 変更箇所（複数対応） */}
      {j.diffs.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>
            変更箇所（{j.diffs.length}）
          </div>
          {j.diffs.map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "8px 0",
                borderTop: i > 0 ? "1px solid #f0efee" : "none",
              }}
            >
              <span style={{ fontSize: 13, color: "#78716c", minWidth: 20 }}>
                {i + 1}.
              </span>
              <span
                style={{
                  background: "#fef2f2",
                  color: "#b91c1c",
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: 14,
                }}
              >
                {d.before || "（なし）"}
              </span>
              <span style={{ color: "#78716c" }}>→</span>
              <span
                style={{
                  background: "#f0fdf4",
                  color: "#15803d",
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: 14,
                }}
              >
                {d.after || "（なし）"}
              </span>
              {d.kind && (
                <span style={{ fontSize: 12, color: "#78716c" }}>[{d.kind}]</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 元の文面 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={label}>① AIの下書き</div>
          <p style={pre}>{j.ai_message}</p>
        </div>
        <div style={card}>
          <div style={label}>② 実際に送信</div>
          <p style={pre}>{j.sent_message}</p>
        </div>
      </div>

      {/* 技術情報 */}
      <div style={card}>
        <div style={label}>技術情報</div>
        <table style={{ fontSize: 13, color: "#57534e" }}>
          <tbody>
            <tr><td style={{ paddingRight: 16, color: "#78716c" }}>モデル</td><td>{j.model ?? "—"}</td></tr>
            <tr><td style={{ paddingRight: 16, color: "#78716c" }}>プロンプト版</td><td>{j.review_prompt_version ?? "—"}</td></tr>
            <tr><td style={{ paddingRight: 16, color: "#78716c" }}>レスポンスID</td><td>{j.openai_response_id ?? "—"}</td></tr>
            {j.openai_error && (
              <tr><td style={{ paddingRight: 16, color: "#78716c" }}>OpenAIエラー</td><td style={{ color: "#c2410c" }}>{j.openai_error}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

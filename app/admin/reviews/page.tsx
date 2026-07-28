import { listJudgments, countJudgments } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAULT_LABEL: Record<string, string> = {
  judgment: "判断ミス",
  generation: "生成ミス",
  none: "修正なし",
  unknown: "保留",
};

const FAULT_COLOR: Record<string, string> = {
  judgment: "#b91c1c",
  generation: "#c2410c",
  none: "#15803d",
  unknown: "#78716c",
};

function DbError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
        データベースに接続できません
      </p>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{msg}</pre>
    </div>
  );
}

export default async function ReviewListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const perPage = 50;

  let rows;
  let total: number;
  try {
    [rows, total] = await Promise.all([
      listJudgments(perPage, (page - 1) * perPage),
      countJudgments(),
    ]);
  } catch (err) {
    return <DbError error={err} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 10px",
    borderBottom: "2px solid #e7e5e4",
    fontSize: 12,
    color: "#78716c",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "9px 10px",
    borderBottom: "1px solid #f0efee",
    fontSize: 14,
    verticalAlign: "top",
  };

  return (
    <>
      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 12px" }}>
        全 {total} 件 ／ {page} / {totalPages} ページ
      </p>

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "#78716c" }}>
          判定結果がまだありません。
        </div>
      ) : (
        <div
          style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>チケット</th>
                <th style={th}>担当</th>
                <th style={th}>帰属</th>
                <th style={{ ...th, textAlign: "right" }}>修正量</th>
                <th style={{ ...th, textAlign: "right" }}>箇所</th>
                <th style={th}>要約</th>
                <th style={th}>判定日時</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticket_id}>
                  <td style={td}>
                    <a
                      href={`/admin/reviews/${encodeURIComponent(r.ticket_id)}`}
                      style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}
                    >
                      {r.ticket_id}
                    </a>
                  </td>
                  <td style={td}>{r.staff_id ?? "—"}</td>
                  <td style={td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        color: "#fff",
                        background: FAULT_COLOR[r.fault] ?? "#78716c",
                      }}
                    >
                      {FAULT_LABEL[r.fault] ?? r.fault}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>{r.diff_ratio}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.diff_count}</td>
                  <td style={{ ...td, color: "#57534e" }}>
                    {r.diff_summary ??
                      (r.openai_error ? (
                        <span style={{ color: "#c2410c" }}>OpenAI: {r.openai_error}</span>
                      ) : (
                        "—"
                      ))}
                  </td>
                  <td style={{ ...td, color: "#78716c", fontSize: 13, whiteSpace: "nowrap" }}>
                    {new Date(r.judged_at).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "center" }}>
          {page > 1 && (
            <a href={`/admin/reviews?page=${page - 1}`} style={pagerStyle}>
              ← 前
            </a>
          )}
          <span style={{ padding: "6px 12px", fontSize: 14, color: "#78716c" }}>
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a href={`/admin/reviews?page=${page + 1}`} style={pagerStyle}>
              次 →
            </a>
          )}
        </div>
      )}
    </>
  );
}

const pagerStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "#fff",
  border: "1px solid #e7e5e4",
  borderRadius: 6,
  textDecoration: "none",
  color: "#1c1917",
  fontSize: 14,
};

import { listJudgments, countJudgments, type JudgmentFilter } from "@/lib/store";
import {
  th, td, TableCard, FaultBadge, Pager, SearchForm, DbError, Empty, formatJST,} from "../_components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_PAGE = 50;

export default async function ReviewListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const filter: JudgmentFilter = {
    ticket_id: sp.ticket_id || undefined,
    staff_id: sp.staff_id || undefined,
    staff_name: sp.staff_name || undefined,
    keyword: sp.keyword || undefined,
    fault: sp.fault || undefined,
    date_from: sp.date_from || undefined,
    date_to: sp.date_to || undefined,
  };

  let rows;
  let total: number;
  try {
    [rows, total] = await Promise.all([
      listJudgments(filter, PER_PAGE, (page - 1) * PER_PAGE),
      countJudgments(filter),
    ]);
  } catch (err) {
    return <DbError error={err} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // 現在の検索条件を保ったままページ番号だけ変えるURL
  const makeHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") q.set(k, v);
    }
    q.set("page", String(p));
    return `/admin/reviews?${q.toString()}`;
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>判定結果</h1>

      <SearchForm
        action="/admin/reviews"
        values={sp as Record<string, string>}
        fields={[
          { name: "ticket_id", label: "チケットID" },
          { name: "staff_name", label: "担当者名" },
          { name: "keyword", label: "本文（部分一致）" },
          {
            name: "fault",
            label: "帰属",
            type: "select",
            options: [
              { value: "", label: "すべて" },
              { value: "judgment", label: "判断ミス" },
              { value: "generation", label: "生成ミス" },
              { value: "none", label: "修正なし" },
              { value: "unknown", label: "保留" },
            ],
          },
          { name: "date_from", label: "判定日（から）", type: "date" },
          { name: "date_to", label: "判定日（まで）", type: "date" },
        ]}
      />

      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 12px" }}>
        全 {total} 件 ／ {page} / {totalPages} ページ
      </p>

      {rows.length === 0 ? (
        <Empty>該当する判定結果がありません。</Empty>
      ) : (
        <TableCard>
          <>
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
                  <td style={td}>{r.staff_name ?? r.staff_id ?? "—"}</td>
                  <td style={td}><FaultBadge fault={r.fault} /></td>
                  <td style={{ ...td, textAlign: "right" }}>{r.diff_ratio}</td>
                  <td style={{ ...td, textAlign: "right" }}>{r.diff_count}</td>
                  <td style={{ ...td, color: "#57534e", maxWidth: 280 }}>
                    {r.diff_summary ??
                      (r.openai_error ? (
                        <span style={{ color: "#c2410c" }}>OpenAI: {r.openai_error}</span>
                      ) : "—")}
                  </td>
                  <td style={{ ...td, color: "#78716c", fontSize: 13, whiteSpace: "nowrap" }}>
                    {formatJST(r.judged_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        </TableCard>
      )}

      <Pager page={page} totalPages={totalPages} makeHref={makeHref} />
    </>
  );
}

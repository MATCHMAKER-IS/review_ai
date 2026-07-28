import { listMessages, countMessages, type MessageFilter } from "@/lib/store";
import {
  th, td, TableCard, TypeBadge, Pager, SearchForm, DbError, Empty,
} from "../_components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_PAGE = 50;

function truncate(s: string, n = 40): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

export default async function MessageListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const filter: MessageFilter = {
    ticket_id: sp.ticket_id || undefined,
    staff_id: sp.staff_id || undefined,
    keyword: sp.keyword || undefined,
    type: sp.type === "ai" || sp.type === "sent" ? sp.type : undefined,
    date_from: sp.date_from || undefined,
    date_to: sp.date_to || undefined,
  };

  let rows;
  let total: number;
  try {
    [rows, total] = await Promise.all([
      listMessages(filter, PER_PAGE, (page - 1) * PER_PAGE),
      countMessages(filter),
    ]);
  } catch (err) {
    return <DbError error={err} />;
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const makeHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "page") q.set(k, v);
    }
    q.set("page", String(p));
    return `/admin/messages?${q.toString()}`;
  };

  return (
    <>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>受信メッセージ</h1>

      <SearchForm
        action="/admin/messages"
        values={sp as Record<string, string>}
        fields={[
          { name: "ticket_id", label: "チケットID" },
          { name: "staff_id", label: "担当者ID" },
          { name: "keyword", label: "本文（部分一致）" },
          {
            name: "type",
            label: "種別",
            type: "select",
            options: [
              { value: "", label: "すべて" },
              { value: "ai", label: "AI下書き" },
              { value: "sent", label: "送信済み" },
            ],
          },
          { name: "date_from", label: "受信日（から）", type: "date" },
          { name: "date_to", label: "受信日（まで）", type: "date" },
        ]}
      />

      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 12px" }}>
        全 {total} 件 ／ {page} / {totalPages} ページ
      </p>

      {rows.length === 0 ? (
        <Empty>該当するメッセージがありません。</Empty>
      ) : (
        <TableCard>
          <>
            <thead>
              <tr>
                <th style={th}>チケット</th>
                <th style={th}>種別</th>
                <th style={th}>担当</th>
                <th style={th}>本文（先頭）</th>
                <th style={th}>受信日時</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={td}>{m.ticket_id}</td>
                  <td style={td}><TypeBadge type={m.type} /></td>
                  <td style={td}>{m.staff_id ?? "—"}</td>
                  <td style={{ ...td, maxWidth: 360 }}>
                    <a
                      href={`/admin/messages/${m.id}`}
                      style={{ color: "#1d4ed8", textDecoration: "none" }}
                    >
                      {truncate(m.message)}
                    </a>
                  </td>
                  <td style={{ ...td, color: "#78716c", fontSize: 13, whiteSpace: "nowrap" }}>
                    {new Date(m.received_at).toLocaleString("ja-JP")}
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

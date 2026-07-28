import { getMessage } from "@/lib/store";
import { card, label, pre, TypeBadge } from "../../_components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let m;
  try {
    m = await getMessage(id);
  } catch (err) {
    return (
      <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8 }}>
        <pre style={pre}>{err instanceof Error ? err.message : String(err)}</pre>
      </div>
    );
  }

  if (!m) {
    return (
      <>
        <a href="/admin/messages" style={{ color: "#1d4ed8" }}>← 受信メッセージ一覧へ</a>
        <p style={{ marginTop: 16 }}>メッセージが見つかりません。</p>
      </>
    );
  }

  return (
    <>
      <a href="/admin/messages" style={{ color: "#1d4ed8", textDecoration: "none" }}>
        ← 受信メッセージ一覧へ
      </a>

      <h1 style={{ fontSize: 20, margin: "12px 0 8px", display: "flex", gap: 10, alignItems: "center" }}>
        {m.ticket_id} <TypeBadge type={m.type} />
      </h1>
      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 16px" }}>
        担当: {m.staff_id ?? "—"} ／ メモリ版: {m.memory_version ?? "—"} ／ 受信:{" "}
        {new Date(m.received_at).toLocaleString("ja-JP")}
      </p>

      <div style={card}>
        <div style={label}>本文</div>
        <p style={pre}>{m.message}</p>
      </div>

      <div style={card}>
        <div style={label}>関連</div>
        <a
          href={`/admin/reviews/${encodeURIComponent(m.ticket_id)}`}
          style={{ color: "#1d4ed8", fontSize: 14 }}
        >
          このチケットの判定結果を見る →
        </a>
      </div>
    </>
  );
}

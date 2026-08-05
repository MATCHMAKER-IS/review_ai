import { getJudgment, getMessagesByTicket, listComments } from "@/lib/store";
import { postComment } from "../actions";
import { card, label, pre, TypeBadge, HighlightedBody, formatJST} from "../../_components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAULT_FULL: Record<string, string> = {
  judgment: "判断AIのミス",
  generation: "生成AIのミス",
  none: "修正なし",
  unknown: "保留（要人手確認）",
};

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  const decoded = decodeURIComponent(ticketId);

  let j;
  let messages;
  let comments;
  try {
    [j, messages, comments] = await Promise.all([
      getJudgment(decoded),
      getMessagesByTicket(decoded),
      listComments(decoded),
    ]);
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
        <a href="/admin/reviews" style={{ color: "#1d4ed8" }}>← 判定結果一覧へ</a>
        <p style={{ marginTop: 16 }}>チケット「{decoded}」の判定結果が見つかりません。</p>
      </>
    );
  }

  return (
    <>
      <a href="/admin/reviews" style={{ color: "#1d4ed8", textDecoration: "none" }}>
        ← 判定結果一覧へ
      </a>

      <h1 style={{ fontSize: 20, margin: "12px 0 4px" }}>{j.ticket_id}</h1>
      <p style={{ fontSize: 13, color: "#78716c", margin: "0 0 16px" }}>
        担当: {j.staff_name ?? j.staff_id ?? "—"} ／ メモリ版: {j.memory_version ?? "—"} ／ 判定:{" "}
        {formatJST(j.judged_at)}
      </p>

      <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={label}>帰属</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{FAULT_FULL[j.fault] ?? j.fault}</div>
        </div>
        <div>
          <div style={label}>差分あり</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{j.has_diff ? "あり" : "なし"}</div>
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

      {j.diffs.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>変更箇所（{j.diffs.length}）</div>
          {j.diffs.map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                padding: "8px 0", borderTop: i > 0 ? "1px solid #f0efee" : "none",
              }}
            >
              <span style={{ fontSize: 13, color: "#78716c", minWidth: 20 }}>{i + 1}.</span>
              <span style={{ background: "#fef2f2", color: "#b91c1c", padding: "3px 8px", borderRadius: 4, fontSize: 14 }}>
                {d.before || "（なし）"}
              </span>
              <span style={{ color: "#78716c" }}>→</span>
              <span style={{ background: "#f0fdf4", color: "#15803d", padding: "3px 8px", borderRadius: 4, fontSize: 14 }}>
                {d.after || "（なし）"}
              </span>
              {d.kind && <span style={{ fontSize: 12, color: "#78716c" }}>[{d.kind}]</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={label}>① AIの下書き</div>
          <HighlightedBody
            text={j.ai_message}
            marks={j.diffs.map((d) => d.before)}
            color="before"
          />
        </div>
        <div style={card}>
          <div style={label}>② 実際に送信</div>
          <HighlightedBody
            text={j.sent_message}
            marks={j.diffs.map((d) => d.after)}
            color="after"
          />
        </div>
      </div>

      {j.diffs.length > 0 && (
        <p style={{ fontSize: 12, color: "#78716c", margin: "-4px 0 16px" }}>
          ①は<mark style={{ background: "#fee2e2", color: "#991b1b", padding: "1px 4px", borderRadius: 3 }}>変更前</mark>、
          ②は<mark style={{ background: "#dcfce7", color: "#166534", padding: "1px 4px", borderRadius: 3 }}>変更後</mark>
          の箇所を色付けしています。
        </p>
      )}

      {/* このチケットの受信ログ */}
      {messages.length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>受信ログ（{messages.length}）</div>
          {messages.map((m) => (
            <div key={m.id} style={{ padding: "8px 0", borderTop: "1px solid #f0efee", display: "flex", gap: 10, alignItems: "baseline" }}>
              <TypeBadge type={m.type} />
              <a href={`/admin/messages/${m.id}`} style={{ color: "#1d4ed8", fontSize: 13 }}>詳細</a>
              <span style={{ fontSize: 12, color: "#78716c" }}>
                {formatJST(m.received_at)}
              </span>
            </div>
          ))}
        </div>
      )}

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

      {/* コメント（人が残すメモ）*/}
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>
          コメント（{comments.length}）
        </div>

        {comments.length === 0 ? (
          <p style={{ fontSize: 13, color: "#a8a29e", margin: "0 0 14px" }}>
            まだコメントはありません。
          </p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {comments.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: "10px 0",
                  borderTop: "1px solid #f0efee",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {c.author || "名無し"}
                  </span>
                  <span style={{ fontSize: 12, color: "#a8a29e" }}>
                    {formatJST(c.created_at)}
                  </span>
                </div>
                <p style={{ ...pre, fontSize: 14 }}>{c.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* 投稿フォーム */}
        <form action={postComment} style={{ borderTop: "1px solid #f0efee", paddingTop: 12 }}>
          <input type="hidden" name="ticket_id" value={j.ticket_id} />
          <input
            type="text"
            name="author"
            placeholder="お名前（任意）"
            style={{
              width: 200,
              padding: "6px 8px",
              border: "1px solid #d6d3d1",
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 8,
              display: "block",
            }}
          />
          <textarea
            name="body"
            required
            rows={3}
            placeholder="コメントを入力…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              border: "1px solid #d6d3d1",
              borderRadius: 6,
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <button
            type="submit"
            style={{
              marginTop: 8,
              padding: "7px 18px",
              background: "#1c1917",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            コメントする
          </button>
        </form>
      </div>

      {/* OpenAI の生レスポンス（監査用・既定は畳む） */}
      {j.openai_raw != null && (
        <details style={card}>
          <summary style={{ ...label, cursor: "pointer", marginBottom: 0 }}>
            OpenAI レスポンス全文（JSON）
          </summary>
          <pre
            style={{
              ...pre,
              marginTop: 12,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              background: "#f5f5f4",
              padding: 12,
              borderRadius: 6,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(j.openai_raw, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}

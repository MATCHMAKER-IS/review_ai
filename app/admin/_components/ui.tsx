import type { CSSProperties, ReactNode } from "react";

/* 管理画面で共通して使う小さな部品たち */

export const card: CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: "16px 18px",
  marginBottom: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};

export const label: CSSProperties = {
  fontSize: 12,
  color: "#78716c",
  marginBottom: 4,
};

export const pre: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: 1.7,
};

export const FAULT_LABEL: Record<string, string> = {
  judgment: "判断ミス",
  generation: "生成ミス",
  none: "修正なし",
  unknown: "保留",
};

export const FAULT_COLOR: Record<string, string> = {
  judgment: "#b91c1c",
  generation: "#c2410c",
  none: "#15803d",
  unknown: "#78716c",
};

export function FaultBadge({ fault }: { fault: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        color: "#fff",
        whiteSpace: "nowrap",
        background: FAULT_COLOR[fault] ?? "#78716c",
      }}
    >
      {FAULT_LABEL[fault] ?? fault}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const ai = type === "ai";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        color: ai ? "#1d4ed8" : "#15803d",
        background: ai ? "#eff6ff" : "#f0fdf4",
      }}
    >
      {ai ? "AI下書き" : "送信済み"}
    </span>
  );
}

/** ページャ。現在ページ・総ページ・リンクの組み立て関数を受け取る */
export function Pager({
  page,
  totalPages,
  makeHref,
}: {
  page: number;
  totalPages: number;
  makeHref: (p: number) => string;
}) {
  if (totalPages <= 1) return null;
  const btn: CSSProperties = {
    padding: "6px 12px",
    background: "#fff",
    border: "1px solid #e7e5e4",
    borderRadius: 6,
    textDecoration: "none",
    color: "#1c1917",
    fontSize: 14,
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        marginTop: 16,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {page > 1 ? (
        <a href={makeHref(page - 1)} style={btn}>
          ← 前
        </a>
      ) : (
        <span style={{ ...btn, opacity: 0.4 }}>← 前</span>
      )}
      <span style={{ padding: "6px 12px", fontSize: 14, color: "#78716c" }}>
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <a href={makeHref(page + 1)} style={btn}>
          次 →
        </a>
      ) : (
        <span style={{ ...btn, opacity: 0.4 }}>次 →</span>
      )}
    </div>
  );
}

/** 検索フォーム。GET で自分自身に飛ばすだけの素朴な作り */
export function SearchForm({
  action,
  fields,
  values,
}: {
  action: string;
  fields: Array<{
    name: string;
    label: string;
    type?: "text" | "date" | "select";
    options?: Array<{ value: string; label: string }>;
  }>;
  values: Record<string, string>;
}) {
  const input: CSSProperties = {
    padding: "6px 8px",
    border: "1px solid #d6d3d1",
    borderRadius: 6,
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  };
  return (
    <form
      action={action}
      method="get"
      style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
    >
      {fields.map((f) => (
        <div key={f.name} style={{ flex: "1 1 150px", minWidth: 120 }}>
          <div style={label}>{f.label}</div>
          {f.type === "select" ? (
            <select name={f.name} defaultValue={values[f.name] ?? ""} style={input}>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type ?? "text"}
              name={f.name}
              defaultValue={values[f.name] ?? ""}
              style={input}
            />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          style={{
            padding: "7px 16px",
            background: "#1c1917",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          検索
        </button>
        <a
          href={action}
          style={{
            padding: "7px 14px",
            background: "#fff",
            color: "#57534e",
            border: "1px solid #d6d3d1",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          クリア
        </a>
      </div>
    </form>
  );
}

export function DbError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div style={{ padding: 16, background: "#fef2f2", borderRadius: 8 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
        データベースに接続できません
      </p>
      <pre style={{ ...pre, fontSize: 13 }}>{msg}</pre>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 24, textAlign: "center", color: "#78716c" }}>
      {children}
    </div>
  );
}

export const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #e7e5e4",
  fontSize: 12,
  color: "#78716c",
  whiteSpace: "nowrap",
};

export const td: CSSProperties = {
  padding: "9px 10px",
  borderBottom: "1px solid #f0efee",
  fontSize: 14,
  verticalAlign: "top",
};

export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

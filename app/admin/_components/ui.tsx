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

/**
 * 本文中の該当箇所を色付けして表示します。
 *
 * diffs の before（①用）または after（②用）に一致する部分文字列を探し、
 * その箇所だけ背景色を付けます。空文字（追加・削除で相方が無い場合）は
 * 対象にしません。単純な部分文字列一致なので、同じ語が複数あれば
 * すべて着色されます（実務上はほぼ問題になりません）。
 */
export function HighlightedBody({
  text,
  marks,
  color,
}: {
  text: string;
  marks: string[];
  color: "before" | "after";
}) {
  // 着色対象の絞り込み。
  //   - 空や1文字は対象外（「。」「、」1文字が本文全体に散らばって
  //     色付くのを防ぐ）
  //   - 句読点・記号・空白だけの断片は対象外
  // 意味のある語句だけを着色します。
  const isMeaningful = (m: string): boolean => {
    const t = m.trim();
    if (t.length < 2) return false;
    // 記号・句読点・空白のみなら除外
    if (/^[\s、。，．・…！？!?"'（）()「」『』【】〈〉《》\-—~〜:：;；]+$/u.test(t))
      return false;
    return true;
  };
  const targets = Array.from(new Set(marks.filter(isMeaningful)));
  if (targets.length === 0) {
    return <p style={pre}>{text}</p>;
  }

  // 一致箇所の範囲を集める。
  // 各ターゲットにつき最初の1回だけを着色します。同じ語が本文に
  // 複数あっても全部塗ると読みにくく、差分箇所が埋もれるためです。
  // 長いターゲットから先に処理し、既に塗った範囲とは重ねません。
  type Range = { start: number; end: number };
  const ranges: Range[] = [];
  const sorted = [...targets].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(t, from);
      if (idx === -1) break;
      const overlaps = ranges.some(
        (r) => idx < r.end && idx + t.length > r.start,
      );
      if (!overlaps) {
        ranges.push({ start: idx, end: idx + t.length });
        break; // このターゲットは1回だけ
      }
      from = idx + 1;
    }
  }
  if (ranges.length === 0) {
    return <p style={pre}>{text}</p>;
  }

  // 範囲を昇順に並べ、重なりを吸収
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const bg = color === "before" ? "#fee2e2" : "#dcfce7";
  const fg = color === "before" ? "#991b1b" : "#166534";

  // テキストを「通常 / 着色」の断片に分割
  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) {
      parts.push({ text: text.slice(cursor, r.start), hit: false });
    }
    parts.push({ text: text.slice(r.start, r.end), hit: true });
    cursor = r.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), hit: false });
  }

  return (
    <p style={pre}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark
            key={i}
            style={{
              background: bg,
              color: fg,
              padding: "1px 2px",
              borderRadius: 3,
            }}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}


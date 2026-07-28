import type { ReactNode } from "react";

export const metadata = {
  title: "レビュー判定 管理画面",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif",
          background: "#f5f5f4",
          color: "#1c1917",
        }}
      >
        <header
          style={{
            background: "#1c1917",
            color: "#fff",
            padding: "12px 20px",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          <a href="/admin/reviews" style={{ color: "#fff", textDecoration: "none" }}>
            セッティングAI ／ レビュー判定一覧
          </a>
        </header>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px" }}>
          {children}
        </div>
      </body>
    </html>
  );
}

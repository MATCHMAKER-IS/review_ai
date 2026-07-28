import type { ReactNode } from "react";

export const metadata = {
  title: "セッティングAI 管理画面",
};

const NAV = [
  { href: "/admin/reviews", label: "判定結果", icon: "◆" },
  { href: "/admin/messages", label: "受信メッセージ", icon: "✉" },
];

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
        <div style={{ display: "flex", minHeight: "100vh" }}>
          {/* ── 左メニュー ── */}
          <aside
            style={{
              width: 220,
              background: "#1c1917",
              color: "#e7e5e4",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "18px 20px",
                fontSize: 15,
                fontWeight: 700,
                color: "#fff",
                borderBottom: "1px solid #292524",
              }}
            >
              セッティングAI
              <div style={{ fontSize: 11, color: "#a8a29e", fontWeight: 400, marginTop: 2 }}>
                レビュー判定 管理画面
              </div>
            </div>
            <nav style={{ padding: "10px 0", flex: 1 }}>
              {NAV.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "11px 20px",
                    color: "#e7e5e4",
                    textDecoration: "none",
                    fontSize: 14,
                  }}
                >
                  <span style={{ opacity: 0.7, width: 16 }}>{n.icon}</span>
                  {n.label}
                </a>
              ))}
            </nav>
            <div
              style={{
                padding: "14px 20px",
                fontSize: 11,
                color: "#78716c",
                borderTop: "1px solid #292524",
              }}
            >
              会員情報を含みます。取扱注意。
            </div>
          </aside>

          {/* ── 右コンテンツ ── */}
          <main style={{ flex: 1, minWidth: 0 }}>
            <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 60px" }}>
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

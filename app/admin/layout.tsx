import type { ReactNode } from "react";
import { headers } from "next/headers";

export const metadata = {
  title: "セッティングAI 管理画面",
};

const NAV = [
  { href: "/admin/reviews", label: "判定結果", icon: "◆" },
  { href: "/admin/messages", label: "受信メッセージ", icon: "✉" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // 現在のパスを取得して、対応するメニューをカレント表示にします。
  // middleware が x-pathname を付けていればそれを、無ければ referer 等では
  // 取れないため、各項目の href で前方一致判定します。
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";

  return (
    <html lang="ja">
      <head>
        <style>{`
          .nav-link {
            display: flex;
            gap: 10px;
            align-items: center;
            padding: 11px 20px;
            color: #e7e5e4;
            text-decoration: none;
            font-size: 14px;
            border-left: 3px solid transparent;
            transition: background 0.12s, color 0.12s;
          }
          .nav-link:hover {
            background: #292524;
            color: #fff;
          }
          .nav-link.current {
            background: #292524;
            color: #fff;
            border-left-color: #3b82f6;
            font-weight: 600;
          }
          .nav-link .nav-icon { opacity: 0.7; width: 16px; }
          .nav-link.current .nav-icon { opacity: 1; }
        `}</style>
      </head>
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
              {NAV.map((n) => {
                const isCurrent = pathname.startsWith(n.href);
                return (
                  <a
                    key={n.href}
                    href={n.href}
                    className={`nav-link${isCurrent ? " current" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    <span className="nav-icon">{n.icon}</span>
                    {n.label}
                  </a>
                );
              })}
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

import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "セッティングAI レビュー学習",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header>
          <strong>セッティングAI</strong>
          <span className="sub">④ レビュー学習 / メモリ提案</span>
          <span style={{ marginLeft: "auto" }}>
            <a href="/proposals" style={{ color: "#9AA4B6" }}>
              提案一覧
            </a>
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}

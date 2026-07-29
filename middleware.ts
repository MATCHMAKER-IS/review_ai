import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 管理画面(/admin/*)にだけ Basic 認証をかけます。
 *
 * ★ /api/* には一切かけません。
 *   Talend / Deluge からの POST /api/review を認証で弾かないためです。
 *   画面だけを守り、APIは X-Api-Key（HOOK_SECRET）で別途守っています。
 *
 * 認証情報は環境変数で設定します。
 *   BASIC_AUTH_USER … ユーザー名
 *   BASIC_AUTH_PASS … パスワード
 * どちらか未設定なら認証をかけません（ローカル開発用）。
 *
 * あわせて、現在のパスを x-pathname ヘッダーに載せて渡します。
 * レイアウトが「今どのページか」を判定して、左メニューのカレント
 * 表示に使います（Server Component からは自分のパスを直接取れないため）。
 */

export const config = {
  // /admin 以下だけをこのミドルウェアの対象にする
  matcher: ["/admin/:path*"],
};

export function middleware(req: NextRequest): NextResponse {
  // 現在のパスを後段（レイアウト）へ渡すためのヘッダー。
  const withPath = (): NextResponse => {
    const h = new Headers(req.headers);
    h.set("x-pathname", req.nextUrl.pathname);
    return NextResponse.next({ request: { headers: h } });
  };

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // 認証が未設定なら素通し（ただしパスは渡す）
  if (!user || !pass) return withPath();

  const header = req.headers.get("authorization");
  if (header) {
    const encoded = header.split(" ")[1] ?? "";
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === user && p === pass) {
      return withPath();
    }
  }

  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="review-admin"' },
  }) as unknown as NextResponse;
}

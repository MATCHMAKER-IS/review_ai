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
 */

export const config = {
  // /admin 以下だけをこのミドルウェアの対象にする
  matcher: ["/admin/:path*"],
};

export function middleware(req: NextRequest): NextResponse {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // 未設定なら素通し（ローカルで手軽に見るため）
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header) {
    // "Basic base64(user:pass)" を検証
    const encoded = header.split(" ")[1] ?? "";
    const decoded = atob(encoded);
    const idx = decoded.indexOf(":");
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    if (u === user && p === pass) {
      return NextResponse.next();
    }
  }

  // 認証を要求する
  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="review-admin"' },
  }) as unknown as NextResponse;
}

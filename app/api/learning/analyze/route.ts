import { NextResponse } from "next/server";
import { analyzeAll, analyzeStaff } from "@/lib/learning/analyze";
import { staffIdsWithReviews } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// OpenAI呼び出しを含むので長め。Amplifyの上限を超える場合は
// EventBridge + 別Lambda に切り出してください。
export const maxDuration = 300;

/**
 * 分析の起動口。EventBridge や cron から叩く想定です。
 *
 *   POST /api/learning/analyze              全スタッフ
 *   POST /api/learning/analyze?staff=xxx    1人だけ
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staff = new URL(req.url).searchParams.get("staff");

  try {
    const results = staff
      ? [await analyzeStaff(staff)]
      : await analyzeAll(await staffIdsWithReviews());
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[/api/learning/analyze]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

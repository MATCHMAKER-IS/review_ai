import { NextResponse } from "next/server";
import { exportReviews } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 三井さんへの受け渡し口（④の入力／分析用） */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await exportReviews());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

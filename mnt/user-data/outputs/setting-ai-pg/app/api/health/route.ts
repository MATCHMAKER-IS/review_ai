import { NextResponse } from "next/server";
import { queryOne } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Amplifyデプロイ後、まずここでDB接続を確認してください。 */
export async function GET(): Promise<NextResponse> {
  try {
    const r = await queryOne<{ now: Date }>("SELECT now() AS now");
    return NextResponse.json({ ok: true, db_time: r?.now ?? null });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getMemory, memoryHistory } from "@/lib/db";
import type { StaffMemory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * スタッフ個別メモリの取得口。
 *
 *   GET /api/memory?staff_id=coordinator_a
 *
 * 用途は2つです。
 *  1. ②回答生成AI が呼ぶ。rendered をそのままプロンプトに差し込む
 *  2. 「今どの版か」を人が確認する
 *
 * §6-4 のとおり読み取り専用です。更新は承認画面からのみ行います。
 */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.HOOK_SECRET;
  if (secret && req.headers.get("x-api-key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const staffId = new URL(req.url).searchParams.get("staff_id");
  if (!staffId) {
    return NextResponse.json({ error: "staff_id は必須です" }, { status: 400 });
  }

  try {
    const [memory, history] = await Promise.all([
      getMemory(staffId),
      memoryHistory(staffId),
    ]);

    return NextResponse.json({
      staff_id: staffId,
      version: memory.version,
      updated_at: memory.updated_at,
      counts: {
        judgment_rules: memory.judgment_rules.length,
        style_rules: memory.style_rules.length,
        ng_list: memory.ng_list.length,
      },
      rendered: render(memory),
      memory,
      history,
    });
  } catch (err) {
    console.error("[/api/memory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * ②回答生成AI のプロンプトに差し込む形。
 *
 * JSONをそのまま渡すよりこの形の方が指示として効きます。
 * 「どのルールが効いたか」を返させるため、IDは必ず表示に含めます
 * （§3-3 used_memory_rules ／ 引退判定の材料になる）。
 */
function render(m: StaffMemory): string {
  if (
    m.judgment_rules.length === 0 &&
    m.style_rules.length === 0 &&
    m.ng_list.length === 0
  ) {
    return "（このスタッフの個別ルールはまだありません。標準の書き方で作成してください）";
  }

  const parts: string[] = [`# あなたが従うルール（メモリ v${m.version}）`];

  if (m.judgment_rules.length > 0) {
    parts.push(
      "",
      "## 判断のルール",
      ...m.judgment_rules.map((r) => `- [${r.id}] 「${r.when}」のときは「${r.then}」`),
    );
  }

  if (m.style_rules.length > 0) {
    parts.push("", "## 文体のルール");
    for (const r of m.style_rules) {
      parts.push(`- [${r.id}] ${r.rule}`);
      if (r.example_before && r.example_after) {
        parts.push(`    例: 「${r.example_before}」→「${r.example_after}」`);
      }
    }
  }

  if (m.ng_list.length > 0) {
    parts.push(
      "",
      "## 使ってはいけない表現・場面",
      ...m.ng_list.map((n) => `- ${n}`),
    );
  }

  parts.push("", "適用したルールのIDを used_memory_rules に必ず列挙してください。");
  return parts.join("\n");
}

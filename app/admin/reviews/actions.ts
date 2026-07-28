"use server";

import { revalidatePath } from "next/cache";
import { addComment } from "@/lib/store";

/**
 * コメント投稿のサーバーアクション。
 * 詳細ページのフォームから呼ばれ、保存後にそのページを再検証して
 * 最新のコメント一覧を表示します。
 */
export async function postComment(formData: FormData): Promise<void> {
  const ticketId = String(formData.get("ticket_id") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const author = String(formData.get("author") ?? "");

  if (!ticketId || !body.trim()) return;

  await addComment(ticketId, body, author);
  revalidatePath(`/admin/reviews/${encodeURIComponent(ticketId)}`);
}

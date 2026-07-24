"use server";

import { revalidatePath } from "next/cache";
import { approveProposal, rejectProposal } from "@/lib/learning/apply";
import { analyzeStaff } from "@/lib/learning/analyze";

export async function approveAction(formData: FormData): Promise<void> {
  const id = String(formData.get("proposal_id") ?? "");
  if (id) await approveProposal(id);
  revalidatePath("/proposals");
}

export async function rejectAction(formData: FormData): Promise<void> {
  const id = String(formData.get("proposal_id") ?? "");
  if (id) await rejectProposal(id);
  revalidatePath("/proposals");
}

/**
 * 手動で分析を回します。
 *
 * ★ OpenAI呼び出しを含むため、Lambdaのタイムアウトに注意。
 *   レビュー件数が増えて収まらなくなったら、EventBridge から
 *   別Lambdaを叩く形に切り出してください。
 */
export async function analyzeAction(formData: FormData): Promise<void> {
  const staffId = String(formData.get("staff_id") ?? "");
  if (staffId) await analyzeStaff(staffId);
  revalidatePath("/proposals");
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    !["admin", "superadmin"].includes(profile.role)
  ) {
    throw new Error("Forbidden");
  }

  return { supabase, userId: user.id };
}

const actionApprovalSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama Action Approval harus diisi"),
  master_budget_id: z.string().uuid().optional().or(z.literal("")),
  brand_id: z.string().uuid().optional().or(z.literal("")),
  start_date: z.string().min(1, "Tanggal mulai harus diisi"),
  end_date: z.string().min(1, "Tanggal selesai harus diisi"),
  target_budget: z.coerce
    .number()
    .min(0, "Target budget tidak boleh negatif"),
});

export type SaveActionApprovalState = { error?: string; success?: boolean };

export async function saveActionApprovalAction(
  _prevState: SaveActionApprovalState,
  formData: FormData
): Promise<SaveActionApprovalState> {
  try {
    const { supabase, userId } = await requireAdmin();

    const parsed = actionApprovalSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      master_budget_id: formData.get("master_budget_id") || undefined,
      brand_id: formData.get("brand_id") || undefined,
      start_date: formData.get("start_date"),
      end_date: formData.get("end_date"),
      target_budget: formData.get("target_budget"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...fields } = parsed.data;
    const payload = {
      name: fields.name,
      master_budget_id: fields.master_budget_id || null,
      brand_id: fields.brand_id || null,
      start_date: fields.start_date,
      end_date: fields.end_date,
      target_budget: fields.target_budget,
    };

    if (id) {
      const { error } = await supabase
        .from("action_approvals")
        .update(payload)
        .eq("id", id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("action_approvals").insert({
        ...payload,
        created_by: userId,
      });
      if (error) return { error: error.message };
    }

    revalidatePath("/admin/master-data/action-approvals");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteActionApprovalAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { count } = await supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("action_approval_id", id);

    if (count && count > 0) {
      return { error: "Action Approval ini masih digunakan oleh SKP aktif dan tidak dapat dihapus." };
    }

    const { error } = await supabase.from("action_approvals").delete().eq("id", id);
    if (error) return { error: error.message };

    revalidatePath("/admin/master-data/action-approvals");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

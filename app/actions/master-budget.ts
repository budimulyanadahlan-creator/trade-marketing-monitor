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

// ============================================================
// MASTER BUDGETS
// ============================================================

const masterBudgetSchema = z.object({
  id: z.string().uuid().optional(),
  promotion_category_id: z.string().uuid("Kategori promosi harus dipilih"),
  fiscal_year: z.coerce
    .number()
    .int()
    .min(2020, "Tahun minimal 2020")
    .max(2100, "Tahun maksimal 2100"),
  quarter: z.coerce
    .number()
    .int()
    .min(1, "Quarter harus antara 1-4")
    .max(4, "Quarter harus antara 1-4"),
  total_amount: z.coerce.number().int().min(0, "Nominal tidak boleh negatif"),
});

export type SaveMasterBudgetState = {
  error?: string;
  success?: boolean;
  id?: string;
};

export async function saveMasterBudgetAction(
  _prevState: SaveMasterBudgetState,
  formData: FormData
): Promise<SaveMasterBudgetState> {
  try {
    const { supabase, userId } = await requireAdmin();

    const parsed = masterBudgetSchema.safeParse({
      id: formData.get("id") || undefined,
      promotion_category_id: formData.get("promotion_category_id"),
      fiscal_year: formData.get("fiscal_year"),
      quarter: formData.get("quarter"),
      total_amount: formData.get("total_amount"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("master_budgets")
        .update({ promotion_category_id: data.promotion_category_id, fiscal_year: data.fiscal_year, quarter: data.quarter, total_amount: data.total_amount })
        .eq("id", id);
      if (error) {
        if (error.code === "23505")
          return { error: "Budget untuk kategori promosi, tahun, dan quarter ini sudah ada." };
        return { error: error.message };
      }
      revalidatePath("/admin/master-data/budgets");
      return { success: true, id };
    } else {
      const { data: inserted, error } = await supabase
        .from("master_budgets")
        .insert({
          promotion_category_id: data.promotion_category_id,
          fiscal_year: data.fiscal_year,
          quarter: data.quarter,
          total_amount: data.total_amount,
          created_by: userId,
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505")
          return { error: "Budget untuk kategori promosi, tahun, dan quarter ini sudah ada." };
        return { error: error.message };
      }

      revalidatePath("/admin/master-data/budgets");
      return { success: true, id: inserted?.id };
    }
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteMasterBudgetAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("master_budgets")
      .delete()
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/budgets");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// BUDGET ALLOCATIONS
// ============================================================

const budgetAllocationSchema = z.object({
  id: z.string().uuid().optional(),
  master_budget_id: z.string().uuid("Master budget harus dipilih"),
  brand_id: z.string().uuid("Brand harus dipilih"),
  allocated_amount: z.coerce.number().int().min(0, "Nominal tidak boleh negatif"),
  fiscal_year: z.coerce.number().int().min(2020).max(2100),
});

export type SaveBudgetAllocationState = { error?: string; success?: boolean };

export async function saveBudgetAllocationAction(
  _prevState: SaveBudgetAllocationState,
  formData: FormData
): Promise<SaveBudgetAllocationState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = budgetAllocationSchema.safeParse({
      id: formData.get("id") || undefined,
      master_budget_id: formData.get("master_budget_id"),
      brand_id: formData.get("brand_id"),
      allocated_amount: formData.get("allocated_amount"),
      fiscal_year: formData.get("fiscal_year"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("budget_allocations")
        .update({ allocated_amount: data.allocated_amount })
        .eq("id", id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("budget_allocations").insert(data);
      if (error) {
        if (error.code === "23505")
          return { error: "Alokasi untuk brand dan kategori ini sudah ada." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/budgets");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteBudgetAllocationAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("budget_allocations")
      .delete()
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/budgets");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

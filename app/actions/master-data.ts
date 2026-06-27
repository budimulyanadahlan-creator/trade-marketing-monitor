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

  return { supabase };
}

// ============================================================
// DEPARTMENTS
// ============================================================

const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama departemen harus diisi"),
});

export type SaveDepartmentState = { error?: string; success?: boolean };

export async function saveDepartmentAction(
  _prevState: SaveDepartmentState,
  formData: FormData
): Promise<SaveDepartmentState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = departmentSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("departments")
        .update(data)
        .eq("id", id);
      if (error) {
        if (error.code === "23505") return { error: "Nama departemen sudah ada." };
        return { error: error.message };
      }
    } else {
      const { error } = await supabase.from("departments").insert(data);
      if (error) {
        if (error.code === "23505") return { error: "Nama departemen sudah ada." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/departments");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteDepartmentAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("departments").delete().eq("id", id);
    if (error) {
      if (error.code === "23503")
        return { error: "Departemen ini masih digunakan oleh user aktif dan tidak dapat dihapus." };
      return { error: error.message };
    }
    revalidatePath("/admin/master-data/departments");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// BRANDS
// ============================================================

const brandSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama brand harus diisi"),
  code: z
    .string()
    .min(1, "Kode brand harus diisi")
    .max(20, "Kode maksimal 20 karakter")
    .transform((v) => v.toUpperCase()),
});

export type SaveBrandState = { error?: string; success?: boolean };

export async function saveBrandAction(
  _prevState: SaveBrandState,
  formData: FormData
): Promise<SaveBrandState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = brandSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      code: formData.get("code"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase.from("brands").update(data).eq("id", id);
      if (error) {
        if (error.message.includes("unique") || error.code === "23505")
          return { error: "Kode brand sudah digunakan." };
        return { error: error.message };
      }
    } else {
      const { error } = await supabase.from("brands").insert(data);
      if (error) {
        if (error.message.includes("unique") || error.code === "23505")
          return { error: "Kode brand sudah digunakan." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/brands");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function toggleBrandActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("brands")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/brands");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteBrandAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/brands");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// REGIONS
// ============================================================

const regionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama region harus diisi"),
});

export type SaveRegionState = { error?: string; success?: boolean };

export async function saveRegionAction(
  _prevState: SaveRegionState,
  formData: FormData
): Promise<SaveRegionState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = regionSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("regions")
        .update(data)
        .eq("id", id);
      if (error) {
        if (error.code === "23505") return { error: "Nama region sudah ada." };
        return { error: error.message };
      }
    } else {
      const { error } = await supabase.from("regions").insert(data);
      if (error) {
        if (error.code === "23505") return { error: "Nama region sudah ada." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/regions");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function toggleRegionActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("regions")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/regions");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteRegionAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("regions").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/regions");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// CHANNELS
// ============================================================

const channelSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama channel harus diisi").max(10, "Nama maksimal 10 karakter"),
});

export type SaveChannelState = { error?: string; success?: boolean };

export async function saveChannelAction(
  _prevState: SaveChannelState,
  formData: FormData
): Promise<SaveChannelState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = channelSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("channels")
        .update(data)
        .eq("id", id);
      if (error) {
        if (error.code === "23505") return { error: "Nama channel sudah ada." };
        return { error: error.message };
      }
    } else {
      const { error } = await supabase.from("channels").insert(data);
      if (error) {
        if (error.code === "23505") return { error: "Nama channel sudah ada." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/channels");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function toggleChannelActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("channels")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/channels");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteChannelAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("channels").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/channels");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// PROMOTION CATEGORIES
// ============================================================

const promotionCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama kategori harus diisi"),
  type: z.enum(["TP", "CP"], { message: "Tipe harus TP atau CP" }),
  account_code: z.string().min(1, "Kode akun harus diisi").max(20, "Kode akun maksimal 20 karakter"),
});

export type SavePromotionCategoryState = { error?: string; success?: boolean };

export async function savePromotionCategoryAction(
  _prevState: SavePromotionCategoryState,
  formData: FormData
): Promise<SavePromotionCategoryState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = promotionCategorySchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      type: formData.get("type"),
      account_code: formData.get("account_code"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase
        .from("promotion_categories")
        .update(data)
        .eq("id", id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("promotion_categories").insert(data);
      if (error) return { error: error.message };
    }

    revalidatePath("/admin/master-data/categories");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function togglePromotionCategoryActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("promotion_categories")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/categories");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deletePromotionCategoryAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("promotion_categories")
      .delete()
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/categories");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// VENDORS
// ============================================================

const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama vendor harus diisi"),
  contact: z.string().optional().or(z.literal("")),
  service_category: z.string().optional().or(z.literal("")),
});

export type SaveVendorState = { error?: string; success?: boolean };

export async function saveVendorAction(
  _prevState: SaveVendorState,
  formData: FormData
): Promise<SaveVendorState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = vendorSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      contact: formData.get("contact") || undefined,
      service_category: formData.get("service_category") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;
    const payload = {
      name: data.name,
      contact: data.contact || null,
      service_category: data.service_category || null,
    };

    if (id) {
      const { error } = await supabase
        .from("vendors")
        .update(payload)
        .eq("id", id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("vendors").insert(payload);
      if (error) return { error: error.message };
    }

    revalidatePath("/admin/master-data/vendors");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function toggleVendorActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("vendors")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/vendors");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteVendorAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("vendors").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/vendors");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// APPROVAL LEVELS
// ============================================================

const approvalLevelSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama level harus diisi").max(50, "Nama maksimal 50 karakter"),
  sequence: z.coerce.number().int().min(1, "Urutan harus lebih dari 0"),
});

export type SaveApprovalLevelState = { error?: string; success?: boolean };

export async function saveApprovalLevelAction(
  _prevState: SaveApprovalLevelState,
  formData: FormData
): Promise<SaveApprovalLevelState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = approvalLevelSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      sequence: formData.get("sequence"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase.from("approval_levels").update(data).eq("id", id);
      if (error) {
        if (error.code === "23505") return { error: "Nama atau urutan level sudah ada." };
        return { error: error.message };
      }
    } else {
      const { error } = await supabase.from("approval_levels").insert(data);
      if (error) {
        if (error.code === "23505") return { error: "Nama atau urutan level sudah ada." };
        return { error: error.message };
      }
    }

    revalidatePath("/admin/master-data/approvers");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteApprovalLevelAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("approval_levels").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") return { error: "Level masih memiliki penugasan aktif dan tidak dapat dihapus." };
      return { error: error.message };
    }
    revalidatePath("/admin/master-data/approvers");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// APPROVER ASSIGNMENTS
// ============================================================

const approverAssignmentSchema = z.object({
  level_id: z.string().uuid("Level harus dipilih"),
  user_id: z.string().uuid("User harus dipilih"),
});

export type SaveApproverAssignmentState = { error?: string; success?: boolean };

export async function saveApproverAssignmentAction(
  _prevState: SaveApproverAssignmentState,
  formData: FormData
): Promise<SaveApproverAssignmentState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = approverAssignmentSchema.safeParse({
      level_id: formData.get("level_id"),
      user_id: formData.get("user_id"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { error } = await supabase.from("approver_assignments").insert(parsed.data);
    if (error) {
      if (error.code === "23505") return { error: "User ini sudah ditugaskan ke level tersebut." };
      return { error: error.message };
    }

    revalidatePath("/admin/master-data/approvers");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteApproverAssignmentAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();
    const { error } = await supabase.from("approver_assignments").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/master-data/approvers");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// CLAIM DOCUMENT TYPES
// ============================================================

const claimDocumentTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama dokumen harus diisi"),
  sort_order: z.coerce.number().int().min(1, "Urutan harus lebih dari 0"),
});

export type SaveClaimDocumentTypeState = { error?: string; success?: boolean };

export async function saveClaimDocumentTypeAction(
  _prevState: SaveClaimDocumentTypeState,
  formData: FormData
): Promise<SaveClaimDocumentTypeState> {
  try {
    const { supabase } = await requireAdmin();

    const parsed = claimDocumentTypeSchema.safeParse({
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      sort_order: formData.get("sort_order"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...data } = parsed.data;

    if (id) {
      const { error } = await supabase.from("claim_document_types").update(data).eq("id", id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("claim_document_types").insert(data);
      if (error) return { error: error.message };
    }

    revalidatePath("/admin/master-data/claim-requirements");
    return { success: true };
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

export async function deleteClaimDocumentTypeAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const [{ count: reqCount }, { count: checklistCount }] = await Promise.all([
      supabase
        .from("claim_requirements")
        .select("*", { count: "exact", head: true })
        .eq("document_type_id", id),
      supabase
        .from("distributor_claim_checklists")
        .select("*", { count: "exact", head: true })
        .eq("document_type_id", id),
    ]);

    if ((reqCount ?? 0) > 0 || (checklistCount ?? 0) > 0) {
      return { error: "Dokumen ini masih digunakan oleh syarat klaim atau checklist aktif dan tidak dapat dihapus." };
    }

    const { error } = await supabase.from("claim_document_types").delete().eq("id", id);
    if (error) return { error: error.message };

    revalidatePath("/admin/master-data/claim-requirements");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

// ============================================================
// CLAIM REQUIREMENTS (mapping per category)
// ============================================================

export async function saveClaimRequirementsAction(
  categoryId: string,
  documentTypeIds: string[]
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireAdmin();

    const { error: deleteError } = await supabase
      .from("claim_requirements")
      .delete()
      .eq("promotion_category_id", categoryId);
    if (deleteError) return { error: deleteError.message };

    if (documentTypeIds.length > 0) {
      const { error: insertError } = await supabase.from("claim_requirements").insert(
        documentTypeIds.map((docTypeId) => ({
          promotion_category_id: categoryId,
          document_type_id: docTypeId,
        }))
      );
      if (insertError) return { error: insertError.message };
    }

    revalidatePath("/admin/master-data/claim-requirements");
    return {};
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }
}

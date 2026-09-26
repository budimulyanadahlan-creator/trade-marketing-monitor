"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { canManagePosm, POSM_CATEGORIES, POSM_UNITS } from "@/lib/posm";
import type { PosmCategory, PosmUnit, UserRole } from "@/types/database";

const PAGE_PATH = "/monitoring-posm";
const FORBIDDEN = "Anda tidak memiliki akses.";

// RLS (can_manage_posm) tetap jadi penjaga akhir; cek ini untuk pesan ramah
// dan menghindari round-trip yang pasti ditolak.
async function requirePosmWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    !canManagePosm({
      role: profile.role as UserRole,
      departmentName: (profile.department as { name: string } | null)?.name,
    })
  ) {
    throw new Error("Forbidden");
  }

  return { supabase };
}

// ============================================================
// ITEM POSM
// ============================================================

const optionalText = (v: FormDataEntryValue | null) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const posmItemSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string({ error: "Kode item harus diisi" })
    .trim()
    .min(1, "Kode item harus diisi")
    .max(30, "Kode maksimal 30 karakter")
    .transform((v) => v.toUpperCase()),
  name: z.string({ error: "Nama item harus diisi" }).trim().min(1, "Nama item harus diisi"),
  brand_id: z.string().uuid("Brand tidak valid").optional(),
  category: z.enum(POSM_CATEGORIES as [PosmCategory, ...PosmCategory[]], {
    error: "Kategori tidak valid",
  }),
  unit: z.enum(POSM_UNITS as [PosmUnit, ...PosmUnit[]], { error: "Satuan tidak valid" }),
  min_stock: z.coerce
    .number({ error: "Stok minimum harus berupa angka" })
    .int("Stok minimum harus bilangan bulat")
    .min(0, "Stok minimum tidak boleh negatif")
    .optional(),
});

export type SavePosmItemState = { error?: string; success?: boolean };

export async function savePosmItemAction(
  _prevState: SavePosmItemState,
  formData: FormData
): Promise<SavePosmItemState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = posmItemSchema.safeParse({
      id: optionalText(formData.get("id")),
      code: formData.get("code") ?? undefined,
      name: formData.get("name") ?? undefined,
      brand_id: optionalText(formData.get("brand_id")),
      category: formData.get("category") ?? undefined,
      unit: formData.get("unit") ?? undefined,
      min_stock: optionalText(formData.get("min_stock")),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...fields } = parsed.data;
    const data = {
      code: fields.code,
      name: fields.name,
      brand_id: fields.brand_id ?? null,
      category: fields.category,
      unit: fields.unit,
      min_stock: fields.min_stock ?? null,
    };

    const { error } = id
      ? await supabase.from("posm_items").update(data).eq("id", id).is("deleted_at", null)
      : await supabase.from("posm_items").insert(data);

    if (error) {
      if (error.code === "23505")
        return { error: `Kode ${data.code} sudah dipakai item lain. Gunakan kode lain.` };
      return { error: error.message };
    }

    revalidatePath(PAGE_PATH);
    return { success: true };
  } catch {
    return { error: FORBIDDEN };
  }
}

export async function togglePosmItemActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();
    const { error } = await supabase
      .from("posm_items")
      .update({ is_active: isActive })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) return { error: error.message };
    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

// Hapus = soft delete. Fase 2 menambah penolakan untuk item yang sudah
// punya mutasi stok.
export async function deletePosmItemAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();
    const { error } = await supabase
      .from("posm_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) return { error: error.message };
    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

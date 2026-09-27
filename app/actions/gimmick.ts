"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePosmWriter } from "@/lib/posm-writer";
import { GIMMICK_CATEGORIES, GIMMICK_UNITS } from "@/lib/gimmick";
import type { GimmickCategory, GimmickUnit } from "@/types/database";

const PAGE_PATH = "/monitoring-posm";
const FORBIDDEN = "Anda tidak memiliki akses.";

const optionalText = (v: FormDataEntryValue | null) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

// ============================================================
// ITEM GIMMICK
// ============================================================

const gimmickItemSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string({ error: "Kode item harus diisi" })
    .trim()
    .min(1, "Kode item harus diisi")
    .max(30, "Kode maksimal 30 karakter")
    .transform((v) => v.toUpperCase()),
  name: z.string({ error: "Nama item harus diisi" }).trim().min(1, "Nama item harus diisi"),
  brand_id: z.string().uuid("Brand tidak valid").optional(),
  category: z.enum(GIMMICK_CATEGORIES as [GimmickCategory, ...GimmickCategory[]], {
    error: "Kategori tidak valid",
  }),
  unit: z.enum(GIMMICK_UNITS as [GimmickUnit, ...GimmickUnit[]], { error: "Satuan tidak valid" }),
  pcs_per_carton: z.coerce
    .number({ error: "Isi per karton harus berupa angka" })
    .int("Isi per karton harus bilangan bulat")
    .positive("Isi per karton harus lebih dari 0")
    .optional(),
  unit_cost: z
    .string({ error: "Harga pokok harus diisi" })
    .pipe(z.coerce.number<string>({ error: "Harga pokok harus berupa angka" }).min(0, "Harga pokok tidak boleh negatif")),
  suggested_price: z.coerce
    .number({ error: "Harga jual saran harus berupa angka" })
    .min(0, "Harga jual saran tidak boleh negatif")
    .optional(),
  min_stock: z.coerce
    .number({ error: "Stok minimum harus berupa angka" })
    .int("Stok minimum harus bilangan bulat")
    .min(0, "Stok minimum tidak boleh negatif")
    .optional(),
  program: z.string().trim().optional(),
});

// id = record yang disimpan, dipakai form untuk upload foto sesudahnya.
export type SaveGimmickItemState = { error?: string; success?: boolean; id?: string };

export async function saveGimmickItemAction(
  _prevState: SaveGimmickItemState,
  formData: FormData
): Promise<SaveGimmickItemState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = gimmickItemSchema.safeParse({
      id: optionalText(formData.get("id")),
      code: formData.get("code") ?? undefined,
      name: formData.get("name") ?? undefined,
      category: formData.get("category") ?? undefined,
      unit: formData.get("unit") ?? undefined,
      brand_id: optionalText(formData.get("brand_id")),
      pcs_per_carton: optionalText(formData.get("pcs_per_carton")),
      unit_cost: optionalText(formData.get("unit_cost")),
      suggested_price: optionalText(formData.get("suggested_price")),
      min_stock: optionalText(formData.get("min_stock")),
      program: optionalText(formData.get("program")),
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
      pcs_per_carton: fields.pcs_per_carton ?? null,
      unit_cost: fields.unit_cost,
      suggested_price: fields.suggested_price ?? null,
      min_stock: fields.min_stock ?? null,
      program: fields.program ?? null,
    };

    const { data: inserted, error } = id
      ? await supabase.from("gimmick_items").update(data).eq("id", id).is("deleted_at", null)
      : await supabase.from("gimmick_items").insert(data).select("id").single();

    if (error) {
      if (error.code === "23505")
        return { error: `Kode ${data.code} sudah dipakai item gimmick lain. Gunakan kode lain.` };
      return { error: error.message };
    }

    revalidatePath(PAGE_PATH);
    return { success: true, id: id ?? inserted?.id };
  } catch {
    return { error: FORBIDDEN };
  }
}

export async function toggleGimmickItemActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();
    const { error } = await supabase
      .from("gimmick_items")
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

// Hapus = soft delete. Aturan "item yang punya mutasi hanya bisa
// dinonaktifkan" menyusul bersama tabel gimmick_movements (fase 2).
export async function deleteGimmickItemAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();
    const { error } = await supabase
      .from("gimmick_items")
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePosmWriter } from "@/lib/posm-writer";
import {
  canonicalProgram,
  cartonsToPcs,
  formatPcsWithCartons,
  GIMMICK_CATEGORIES,
  GIMMICK_DESTINATIONS,
  GIMMICK_MOVEMENT_TYPES,
  gimmickDestination,
  GIMMICK_UNITS,
} from "@/lib/gimmick";
import { availableFrom, findBalanceViolation, signedQuantity } from "@/lib/posm";
import { formatDate } from "@/lib/utils";
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

    // Program yang beda huruf besar/kecil saja memakai ejaan yang sudah ada.
    // Item yang sedang diedit dikecualikan agar ejaannya sendiri bisa diperbaiki.
    let existingPrograms: { program: string | null }[] = [];
    if (fields.program) {
      let query = supabase.from("gimmick_items").select("program").is("deleted_at", null).not("program", "is", null);
      if (id) query = query.neq("id", id);
      existingPrograms = (await query).data ?? [];
    }

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
      program: canonicalProgram(fields.program, existingPrograms),
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

const ITEM_HAS_MOVEMENTS = "Item sudah punya mutasi stok dan tidak bisa dihapus. Nonaktifkan saja.";

// Hapus = soft delete, hanya untuk item yang belum pernah punya mutasi
// (termasuk mutasi yang sudah dihapus). Trigger gimmick_items_guard_delete
// (migrasi 051) menegakkan aturan yang sama di database.
export async function deleteGimmickItemAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { count } = await supabase
      .from("gimmick_movements")
      .select("id", { count: "exact", head: true })
      .eq("item_id", id);
    if (count) return { error: ITEM_HAS_MOVEMENTS };

    const { error } = await supabase
      .from("gimmick_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) {
      if (error.message.includes("GIMMICK_ITEM_PUNYA_MUTASI")) return { error: ITEM_HAS_MOVEMENTS };
      return { error: error.message };
    }
    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

// ============================================================
// MUTASI STOK GIMMICK
// ============================================================

const wholeNumber = (label: string) =>
  z.coerce
    .number({ error: `${label} harus berupa angka` })
    .int(`${label} harus bilangan bulat`)
    .min(0, `${label} tidak boleh negatif`)
    .optional();

const gimmickMovementSchema = z
  .object({
    id: z.string().uuid().optional(),
    item_id: z.string({ error: "Item tidak valid" }).uuid("Item tidak valid"),
    movement_date: z
      .string({ error: "Tanggal harus diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus diisi"),
    type: z.enum(GIMMICK_MOVEMENT_TYPES, { error: "Tipe mutasi tidak valid" }),
    cartons: wholeNumber("Jumlah karton"),
    pcs: wholeNumber("Jumlah pcs"),
    direction: z.enum(["plus", "minus"]).optional(),
    notes: z.string().trim().optional(),
    destination: z.enum(GIMMICK_DESTINATIONS, { error: "Tujuan keluar tidak valid" }).optional(),
    region_id: z.string().uuid("Region tidak valid").optional(),
    distributor_id: z.string().uuid("Distributor tidak valid").optional(),
    campaign_id: z.string().uuid("SKP tidak valid").optional(),
    recipient_name: z.string().trim().max(100, "Nama PIC maksimal 100 karakter").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "adjustment" && !v.direction)
      ctx.addIssue({ code: "custom", message: "Pilih arah penyesuaian (tambah atau kurang)" });
    if (v.type === "adjustment" && !v.notes)
      ctx.addIssue({ code: "custom", message: "Alasan penyesuaian harus diisi" });
  });

export type SaveGimmickMovementState = { error?: string; success?: boolean };

type GimmickSupabase = Awaited<ReturnType<typeof requirePosmWriter>>["supabase"];
type GimmickItemQty = { unit: string; pcs_per_carton: number | null };

function revalidateGimmickItems(itemIds: string[]) {
  revalidatePath(PAGE_PATH);
  for (const itemId of new Set(itemIds)) revalidatePath(`${PAGE_PATH}/gimmick/items/${itemId}`);
}

async function loadGimmickItem(supabase: GimmickSupabase, itemId: string) {
  const { data } = await supabase
    .from("gimmick_items")
    .select("id, is_active, unit, pcs_per_carton")
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  return data;
}

async function loadActiveGimmickMovements(supabase: GimmickSupabase, itemId: string) {
  const { data } = await supabase
    .from("gimmick_movements")
    .select("id, item_id, movement_date, quantity")
    .eq("item_id", itemId)
    .is("deleted_at", null);
  return data ?? [];
}

// Pesan untuk check constraint tujuan Keluar (migrasi 051), penjaga akhir
// jika validasi server terlewati.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  gimmick_movements_out_destination: "Pilih tujuan keluar",
  gimmick_movements_destination_region: "Region tujuan harus diisi",
  gimmick_movements_notes_required: "Keterangan harus diisi untuk tujuan ini",
};

function gimmickMovementErrorMessage(error: { message: string }) {
  if (error.message.includes("GIMMICK_SALDO_NEGATIF"))
    return "Saldo tidak cukup karena data stok baru saja berubah. Muat ulang halaman lalu coba lagi.";
  const constraint = Object.keys(CONSTRAINT_MESSAGES).find((name) => error.message.includes(`"${name}"`));
  return constraint ? CONSTRAINT_MESSAGES[constraint] : error.message;
}

const qtyText = (qty: number, item: GimmickItemQty) => formatPcsWithCartons(qty, item.pcs_per_carton, item.unit);

export async function saveGimmickMovementAction(
  _prevState: SaveGimmickMovementState,
  formData: FormData
): Promise<SaveGimmickMovementState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = gimmickMovementSchema.safeParse({
      id: optionalText(formData.get("id")),
      item_id: formData.get("item_id") ?? undefined,
      movement_date: formData.get("movement_date") ?? undefined,
      type: formData.get("type") ?? undefined,
      cartons: optionalText(formData.get("cartons")),
      pcs: optionalText(formData.get("pcs")),
      direction: optionalText(formData.get("direction")),
      notes: optionalText(formData.get("notes")),
      destination: optionalText(formData.get("destination")),
      region_id: optionalText(formData.get("region_id")),
      distributor_id: optionalText(formData.get("distributor_id")),
      campaign_id: optionalText(formData.get("campaign_id")),
      recipient_name: optionalText(formData.get("recipient_name")),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, item_id, movement_date, type, cartons, pcs, direction, notes } = parsed.data;

    // Field tujuan wajib per tujuan Keluar; tipe lain mengosongkan semua kolom tujuan.
    const destination = gimmickDestination(parsed.data);
    if ("error" in destination) return { error: destination.error };

    const item = await loadGimmickItem(supabase, item_id);
    if (!item) return { error: "Item gimmick tidak ditemukan." };

    // Konversi karton → pcs memakai isi/karton item dari database.
    const quantity = cartonsToPcs({ cartons: cartons ?? 0, pcs: pcs ?? 0 }, item.pcs_per_carton);
    if (quantity <= 0) return { error: "Qty harus lebih dari 0" };
    const signed = signedQuantity(type, quantity, direction);

    // Saat edit, item boleh diganti: saldo item lama (tanpa mutasi ini) dan
    // item baru (dengan mutasi ini) sama-sama divalidasi.
    let previousItemId = item_id;
    if (id) {
      const { data: existing } = await supabase
        .from("gimmick_movements")
        .select("id, item_id")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!existing) return { error: "Mutasi tidak ditemukan." };
      previousItemId = existing.item_id;
    }
    const itemChanged = previousItemId !== item_id;
    if ((!id || itemChanged) && !item.is_active)
      return { error: "Item nonaktif tidak bisa diberi mutasi baru. Aktifkan item terlebih dahulu." };

    // Trigger database tetap jadi penjaga akhir.
    const others = (await loadActiveGimmickMovements(supabase, item_id)).filter((m) => m.id !== id);
    const violation = findBalanceViolation([...others, { movement_date, quantity: signed }]);
    if (violation) {
      return {
        error:
          signed < 0
            ? `Saldo tidak cukup. Saldo tersedia per ${formatDate(movement_date)}: ${qtyText(availableFrom(others, movement_date), item)}.`
            : `Perubahan ini membuat saldo pada ${formatDate(violation.date)} menjadi ${qtyText(violation.balance, item)}.`,
      };
    }
    if (itemChanged) {
      const remaining = (await loadActiveGimmickMovements(supabase, previousItemId)).filter((m) => m.id !== id);
      const previousViolation = findBalanceViolation(remaining);
      if (previousViolation)
        return {
          error: `Item tidak bisa diganti karena saldo item sebelumnya pada ${formatDate(previousViolation.date)} menjadi ${previousViolation.balance.toLocaleString("id-ID")}.`,
        };
    }

    // unit_cost_snapshot sengaja tidak dikirim: diisi trigger dari harga master.
    const data = { movement_date, type, quantity: signed, notes: notes ?? null, ...destination.fields };

    const { error } = id
      ? await supabase
          .from("gimmick_movements")
          .update(itemChanged ? { ...data, item_id } : data)
          .eq("id", id)
          .is("deleted_at", null)
      : await supabase.from("gimmick_movements").insert({ item_id, ...data });

    if (error) return { error: gimmickMovementErrorMessage(error) };

    revalidateGimmickItems([item_id, previousItemId]);
    return { success: true };
  } catch {
    return { error: FORBIDDEN };
  }
}

// Hapus = soft delete, ditolak jika membuat saldo berjalan negatif.
export async function deleteGimmickMovementAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { data: movement } = await supabase
      .from("gimmick_movements")
      .select("id, item_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!movement) return { error: "Mutasi tidak ditemukan." };

    const remaining = (await loadActiveGimmickMovements(supabase, movement.item_id)).filter((m) => m.id !== id);
    const violation = findBalanceViolation(remaining);
    if (violation) {
      const item = await loadGimmickItem(supabase, movement.item_id);
      const balance = item ? qtyText(violation.balance, item) : violation.balance.toLocaleString("id-ID");
      return {
        error: `Mutasi ini tidak bisa dihapus karena saldo pada ${formatDate(violation.date)} menjadi ${balance}.`,
      };
    }

    const { error } = await supabase
      .from("gimmick_movements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) return { error: gimmickMovementErrorMessage(error) };

    revalidateGimmickItems([movement.item_id]);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

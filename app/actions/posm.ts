"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { formatDate } from "@/lib/utils";
import {
  availableFrom,
  canManagePosm,
  findBalanceViolation,
  POSM_CATEGORIES,
  POSM_MOVEMENT_TYPES,
  POSM_UNITS,
  signedQuantity,
} from "@/lib/posm";
import type { PosmCategory, PosmMovementType, PosmUnit, UserRole } from "@/types/database";

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

const ITEM_HAS_MOVEMENTS = "Item sudah punya mutasi stok dan tidak bisa dihapus. Nonaktifkan saja.";

// Hapus = soft delete, hanya untuk item yang belum pernah punya mutasi
// (termasuk mutasi yang sudah dihapus). Trigger posm_items_guard_delete
// (migrasi 044) menegakkan aturan yang sama di database.
export async function deletePosmItemAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { count } = await supabase
      .from("posm_movements")
      .select("id", { count: "exact", head: true })
      .eq("item_id", id);
    if (count) return { error: ITEM_HAS_MOVEMENTS };

    const { error } = await supabase
      .from("posm_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) {
      if (error.message.includes("POSM_ITEM_PUNYA_MUTASI")) return { error: ITEM_HAS_MOVEMENTS };
      return { error: error.message };
    }
    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

// ============================================================
// MUTASI STOK
// ============================================================

const movementSchema = z
  .object({
    id: z.string().uuid().optional(),
    item_id: z.string({ error: "Item tidak valid" }).uuid("Item tidak valid"),
    movement_date: z
      .string({ error: "Tanggal harus diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus diisi"),
    type: z.enum(POSM_MOVEMENT_TYPES as [PosmMovementType, ...PosmMovementType[]], {
      error: "Tipe mutasi tidak valid",
    }),
    quantity: z.coerce
      .number({ error: "Qty harus berupa angka" })
      .int("Qty harus bilangan bulat")
      .positive("Qty harus lebih dari 0"),
    direction: z.enum(["plus", "minus"]).optional(),
    region_id: z.string().uuid("Region tidak valid").optional(),
    notes: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "out" && !v.region_id)
      ctx.addIssue({ code: "custom", message: "Region tujuan harus diisi untuk mutasi Keluar" });
    if (v.type === "adjustment" && !v.direction)
      ctx.addIssue({ code: "custom", message: "Pilih arah penyesuaian (tambah atau kurang)" });
    if (v.type === "adjustment" && !v.notes)
      ctx.addIssue({ code: "custom", message: "Alasan penyesuaian harus diisi" });
  });

export type SavePosmMovementState = { error?: string; success?: boolean };

function revalidateItem(itemId: string) {
  revalidatePath(PAGE_PATH);
  revalidatePath(`${PAGE_PATH}/items/${itemId}`);
}

export async function savePosmMovementAction(
  _prevState: SavePosmMovementState,
  formData: FormData
): Promise<SavePosmMovementState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = movementSchema.safeParse({
      id: optionalText(formData.get("id")),
      item_id: formData.get("item_id") ?? undefined,
      movement_date: formData.get("movement_date") ?? undefined,
      type: formData.get("type") ?? undefined,
      quantity: optionalText(formData.get("quantity")),
      direction: optionalText(formData.get("direction")),
      region_id: optionalText(formData.get("region_id")),
      notes: optionalText(formData.get("notes")),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, item_id, movement_date, type, quantity, direction, region_id, notes } = parsed.data;
    const signed = signedQuantity(type, quantity, direction);

    const { data: item } = await supabase
      .from("posm_items")
      .select("id, is_active, unit")
      .eq("id", item_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!item) return { error: "Item POSM tidak ditemukan." };
    if (!id && !item.is_active)
      return { error: "Item nonaktif tidak bisa diberi mutasi baru. Aktifkan item terlebih dahulu." };

    const current = await loadActiveMovements(supabase, item_id);
    if (id && !current.some((m) => m.id === id)) return { error: "Mutasi tidak ditemukan." };

    // Validasi saldo berjalan dengan mutasi ini sudah diterapkan (baris lama
    // diganti saat edit). Trigger database tetap jadi penjaga akhir.
    const others = current.filter((m) => m.id !== id);
    const violation = findBalanceViolation([...others, { movement_date, quantity: signed }]);
    if (violation) {
      return {
        error:
          signed < 0
            ? `Saldo tidak cukup. Saldo tersedia per ${formatDate(movement_date)}: ${availableFrom(others, movement_date)} ${item.unit}.`
            : `Perubahan ini membuat saldo pada ${formatDate(violation.date)} menjadi ${violation.balance} ${item.unit}.`,
      };
    }

    const data = {
      movement_date,
      type,
      quantity: signed,
      region_id: type === "out" ? region_id! : null,
      notes: notes ?? null,
    };

    const { error } = id
      ? await supabase.from("posm_movements").update(data).eq("id", id).is("deleted_at", null)
      : await supabase.from("posm_movements").insert({ item_id, ...data });

    if (error) return { error: movementErrorMessage(error) };

    revalidateItem(item_id);
    return { success: true };
  } catch {
    return { error: FORBIDDEN };
  }
}

type PosmSupabase = Awaited<ReturnType<typeof requirePosmWriter>>["supabase"];

async function loadActiveMovements(supabase: PosmSupabase, itemId: string) {
  const { data } = await supabase
    .from("posm_movements")
    .select("id, movement_date, quantity")
    .eq("item_id", itemId)
    .is("deleted_at", null);
  return data ?? [];
}

function movementErrorMessage(error: { message: string }) {
  if (error.message.includes("POSM_SALDO_NEGATIF"))
    return "Saldo tidak cukup karena data stok baru saja berubah. Muat ulang halaman lalu coba lagi.";
  return error.message;
}

// Hapus = soft delete, ditolak jika membuat saldo berjalan negatif.
export async function deletePosmMovementAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { data: movement } = await supabase
      .from("posm_movements")
      .select("id, item_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!movement) return { error: "Mutasi tidak ditemukan." };

    const remaining = (await loadActiveMovements(supabase, movement.item_id)).filter((m) => m.id !== id);
    const violation = findBalanceViolation(remaining);
    if (violation) {
      const { data: item } = await supabase
        .from("posm_items")
        .select("unit")
        .eq("id", movement.item_id)
        .maybeSingle();
      return {
        error: `Mutasi ini tidak bisa dihapus karena saldo pada ${formatDate(violation.date)} menjadi ${violation.balance} ${item?.unit ?? ""}`.trimEnd() + ".",
      };
    }

    const { error } = await supabase
      .from("posm_movements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) return { error: movementErrorMessage(error) };

    revalidateItem(movement.item_id);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

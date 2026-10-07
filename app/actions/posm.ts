"use server";

import { revalidatePath } from "next/cache";
import { requirePosmWriter } from "@/lib/posm-writer";
import { z } from "zod";
import { formatDate } from "@/lib/utils";
import {
  ASSET_CONDITIONS,
  availableFrom,
  findBalanceViolation,
  placementDateViolation,
  type PlacementDateViolation,
  POSM_CATEGORIES,
  POSM_MOVEMENT_TYPES,
  POSM_UNITS,
  signedQuantity,
} from "@/lib/posm";
import type {
  AssetCondition,
  AssetDestination,
  PosmCategory,
  PosmMovementType,
  PosmUnit,
} from "@/types/database";

const PAGE_PATH = "/monitoring-posm";
const FORBIDDEN = "Anda tidak memiliki akses.";

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

// id = record yang disimpan, dipakai form untuk upload foto sesudahnya.
export type SavePosmItemState = { error?: string; success?: boolean; id?: string };

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

    const { data: inserted, error } = id
      ? await supabase.from("posm_items").update(data).eq("id", id).is("deleted_at", null)
      : await supabase.from("posm_items").insert(data).select("id").single();

    if (error) {
      if (error.code === "23505")
        return { error: `Kode ${data.code} sudah dipakai item lain. Gunakan kode lain.` };
      return { error: error.message };
    }

    revalidatePath(PAGE_PATH);
    return { success: true, id: id ?? inserted?.id };
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
    distributor_id: z.string().uuid("Distributor tidak valid").optional(),
    campaign_id: z.string().uuid("SKP tidak valid").optional(),
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
      distributor_id: optionalText(formData.get("distributor_id")),
      campaign_id: optionalText(formData.get("campaign_id")),
      notes: optionalText(formData.get("notes")),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, item_id, movement_date, type, quantity, direction, region_id, distributor_id, campaign_id, notes } =
      parsed.data;
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
      // Tujuan (region wajib, distributor & SKP opsional) hanya untuk Keluar.
      region_id: type === "out" ? region_id! : null,
      distributor_id: type === "out" ? (distributor_id ?? null) : null,
      campaign_id: type === "out" ? (campaign_id ?? null) : null,
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

// ============================================================
// PENCARIAN SKP (mutasi Keluar)
// ============================================================

export type PosmCampaignOption = { id: string; skp_number: string | null; name: string };

// Lewat fungsi database search_posm_campaigns (migrasi 045) karena RLS
// campaigns membatasi user Marketing hanya melihat SKP miliknya sendiri.
export async function searchPosmCampaignsAction(
  query: string
): Promise<{ campaigns: PosmCampaignOption[]; error?: string }> {
  const q = query.trim();
  try {
    const { supabase } = await requirePosmWriter();
    if (q.length < 2) return { campaigns: [] };

    const { data, error } = await supabase.rpc("search_posm_campaigns", { p_query: q });
    if (error) return { campaigns: [], error: error.message };
    return { campaigns: data ?? [] };
  } catch {
    return { campaigns: [], error: FORBIDDEN };
  }
}

// ============================================================
// ASSET MARKETING
// ============================================================

const assetMasterSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string({ error: "Kode asset harus diisi" })
    .trim()
    .min(1, "Kode asset harus diisi")
    .max(30, "Kode maksimal 30 karakter")
    .transform((v) => v.toUpperCase()),
  name: z.string({ error: "Nama asset harus diisi" }).trim().min(1, "Nama asset harus diisi"),
  asset_type_id: z
    .string({ error: "Jenis asset harus dipilih" })
    .min(1, "Jenis asset harus dipilih")
    .uuid("Jenis asset tidak valid"),
  brand_id: z.string().uuid("Brand tidak valid").optional(),
  serial_number: z.string().trim().optional(),
  acquisition_date: z
    .string({ error: "Tanggal perolehan harus diisi" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal perolehan harus diisi"),
  acquisition_value: z.coerce
    .number({ error: "Nilai perolehan harus berupa angka" })
    .min(0, "Nilai perolehan tidak boleh negatif"),
});

// Lokasi awal, hanya saat mendaftarkan asset baru.
const placementFields = z.object({
  event_date: z
    .string({ error: "Tanggal harus diisi" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus diisi"),
  destination: z.enum(["warehouse", "placed"], { error: "Lokasi tidak valid" }),
  region_id: z.string().uuid("Region tidak valid").optional(),
  distributor_id: z.string().uuid("Distributor tidak valid").optional(),
  store_name: z.string().trim().optional(),
  store_address: z.string().trim().optional(),
  pic_name: z.string().trim().optional(),
  condition: z.enum(ASSET_CONDITIONS as [AssetCondition, ...AssetCondition[]], {
    error: "Kondisi tidak valid",
  }),
  notes: z.string().trim().optional(),
});

// Sama dengan constraint asset_placements_placed_location (migrasi 046).
function requireStoreLocation(
  v: { destination: AssetDestination; region_id?: string; store_name?: string },
  ctx: z.RefinementCtx
) {
  if (v.destination !== "placed") return;
  if (!v.region_id)
    ctx.addIssue({ code: "custom", message: "Region harus diisi untuk asset yang ditempatkan" });
  if (!v.store_name)
    ctx.addIssue({ code: "custom", message: "Nama toko harus diisi untuk asset yang ditempatkan" });
}

const assetPlacementSchema = placementFields.superRefine(requireStoreLocation);

function placementFormValues(formData: FormData) {
  return {
    event_date: formData.get("event_date") ?? undefined,
    destination: formData.get("destination") ?? undefined,
    region_id: optionalText(formData.get("region_id")),
    distributor_id: optionalText(formData.get("distributor_id")),
    store_name: optionalText(formData.get("store_name")),
    store_address: optionalText(formData.get("store_address")),
    pic_name: optionalText(formData.get("pic_name")),
    condition: formData.get("condition") ?? undefined,
    notes: optionalText(formData.get("notes")),
  };
}

/** Kolom penempatan; Gudang Pusat tidak menyimpan data lokasi toko. */
function placementColumns(p: z.infer<typeof placementFields>) {
  const placed = p.destination === "placed";
  return {
    event_date: p.event_date,
    destination: p.destination,
    region_id: placed ? p.region_id! : null,
    distributor_id: placed ? (p.distributor_id ?? null) : null,
    store_name: placed ? p.store_name! : null,
    store_address: placed ? (p.store_address ?? null) : null,
    pic_name: p.pic_name ?? null,
    condition: p.condition,
    notes: p.notes ?? null,
  };
}

export type SaveMarketingAssetState = { error?: string; success?: boolean; id?: string };

function assetErrorMessage(error: { message: string; code?: string }, code: string) {
  if (error.code === "23505") return `Kode ${code} sudah dipakai asset lain. Gunakan kode lain.`;
  return error.message;
}

const ASSET_TYPE_INACTIVE = "Jenis asset sudah tidak aktif. Pilih jenis lain.";

/**
 * Jenis harus ada di asset_types. Jenis nonaktif hanya boleh dipertahankan
 * oleh asset yang sudah memakainya (saat edit), tidak untuk asset baru.
 */
async function assetTypeError(
  supabase: Awaited<ReturnType<typeof requirePosmWriter>>["supabase"],
  typeId: string,
  assetId: string | undefined
): Promise<string | undefined> {
  const { data: type } = await supabase
    .from("asset_types")
    .select("id, is_active")
    .eq("id", typeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!type) return "Jenis asset tidak valid";
  if (type.is_active) return undefined;
  if (!assetId) return ASSET_TYPE_INACTIVE;

  const { data: current } = await supabase
    .from("marketing_assets")
    .select("asset_type_id")
    .eq("id", assetId)
    .maybeSingle();
  return current?.asset_type_id === typeId ? undefined : ASSET_TYPE_INACTIVE;
}

export async function saveMarketingAssetAction(
  _prevState: SaveMarketingAssetState,
  formData: FormData
): Promise<SaveMarketingAssetState> {
  try {
    const { supabase } = await requirePosmWriter();

    const master = assetMasterSchema.safeParse({
      id: optionalText(formData.get("id")),
      code: formData.get("code") ?? undefined,
      name: formData.get("name") ?? undefined,
      asset_type_id: formData.get("asset_type_id") ?? undefined,
      brand_id: optionalText(formData.get("brand_id")),
      serial_number: optionalText(formData.get("serial_number")),
      acquisition_date: formData.get("acquisition_date") ?? undefined,
      acquisition_value: optionalText(formData.get("acquisition_value")),
    });
    if (!master.success) return { error: master.error.issues[0]?.message ?? "Input tidak valid" };

    const { id, ...a } = master.data;

    const typeError = await assetTypeError(supabase, a.asset_type_id, id);
    if (typeError) return { error: typeError };

    const assetData = {
      code: a.code,
      name: a.name,
      asset_type_id: a.asset_type_id,
      brand_id: a.brand_id ?? null,
      serial_number: a.serial_number ?? null,
      acquisition_date: a.acquisition_date,
      acquisition_value: a.acquisition_value,
    };

    // Edit hanya mengubah data master; lokasi & kondisi berubah lewat
    // catatan penempatan.
    if (id) {
      const { error } = await supabase
        .from("marketing_assets")
        .update(assetData)
        .eq("id", id)
        .is("deleted_at", null);
      if (error) return { error: assetErrorMessage(error, a.code) };
      revalidatePath(PAGE_PATH);
      return { success: true, id };
    }

    const placement = assetPlacementSchema.safeParse(placementFormValues(formData));
    if (!placement.success) return { error: placement.error.issues[0]?.message ?? "Input tidak valid" };

    const p = placementColumns(placement.data);

    const { data: newId, error } = await supabase.rpc("create_marketing_asset", {
      p_code: assetData.code,
      p_name: assetData.name,
      p_asset_type_id: assetData.asset_type_id,
      p_brand_id: assetData.brand_id,
      p_serial_number: assetData.serial_number,
      p_acquisition_date: assetData.acquisition_date,
      p_acquisition_value: assetData.acquisition_value,
      p_event_date: p.event_date,
      p_destination: p.destination,
      p_region_id: p.region_id,
      p_distributor_id: p.distributor_id,
      p_store_name: p.store_name,
      p_store_address: p.store_address,
      p_pic_name: p.pic_name,
      p_condition: p.condition,
      p_notes: p.notes,
    });
    if (error) return { error: assetErrorMessage(error, a.code) };

    revalidatePath(PAGE_PATH);
    return { success: true, id: newId };
  } catch {
    return { error: FORBIDDEN };
  }
}

const ASSET_HAS_HISTORY =
  "Asset sudah punya riwayat penempatan dan tidak bisa dihapus. Beri kondisi Dihapusbukukan saja.";

// Hapus = soft delete, hanya selama asset baru punya catatan pendaftaran
// (termasuk catatan yang sudah dihapus). Trigger marketing_assets_guard_delete
// (migrasi 046) menegakkan aturan yang sama di database.
export async function deleteMarketingAssetAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { count } = await supabase
      .from("asset_placements")
      .select("id", { count: "exact", head: true })
      .eq("asset_id", id);
    if ((count ?? 0) > 1) return { error: ASSET_HAS_HISTORY };

    const { error } = await supabase
      .from("marketing_assets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) {
      if (error.message.includes("ASSET_PUNYA_RIWAYAT")) return { error: ASSET_HAS_HISTORY };
      return { error: error.message };
    }
    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

// ============================================================
// PENEMPATAN ASSET (pindahkan, edit, hapus)
// ============================================================

const placementSchema = placementFields
  .extend({
    id: z.string().uuid().optional(),
    asset_id: z.string({ error: "Asset tidak valid" }).uuid("Asset tidak valid"),
  })
  .superRefine(requireStoreLocation);

export type SaveAssetPlacementState = { error?: string; success?: boolean; id?: string };

function placementDateMessage(v: PlacementDateViolation) {
  return v.kind === "before_registration"
    ? `Tanggal perpindahan tidak boleh sebelum tanggal pendaftaran asset (${formatDate(v.date)}).`
    : `Tanggal pendaftaran tidak boleh melewati perpindahan pertama (${formatDate(v.date)}).`;
}

function placementErrorMessage(error: { message: string }) {
  if (error.message.includes("ASSET_TANGGAL_"))
    return "Tanggal tidak sesuai urutan riwayat karena data baru saja berubah. Muat ulang halaman lalu coba lagi.";
  if (error.message.includes("ASSET_PENDAFTARAN")) return REGISTRATION_UNDELETABLE;
  if (error.message.includes("ASSET_TIDAK_DITEMUKAN")) return "Asset tidak ditemukan.";
  return error.message;
}

const REGISTRATION_UNDELETABLE =
  "Catatan pendaftaran tidak bisa dihapus. Edit catatan ini jika ada data yang salah.";

function revalidateAsset(assetId: string) {
  revalidatePath(PAGE_PATH);
  revalidatePath(`${PAGE_PATH}/assets/${assetId}`);
}

/** Pindahkan asset (catatan baru) atau edit catatan penempatan (dengan id). */
export async function saveAssetPlacementAction(
  _prevState: SaveAssetPlacementState,
  formData: FormData
): Promise<SaveAssetPlacementState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = placementSchema.safeParse({
      ...placementFormValues(formData),
      id: optionalText(formData.get("id")),
      asset_id: formData.get("asset_id") ?? undefined,
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };

    const { id, asset_id } = parsed.data;
    const data = placementColumns(parsed.data);

    const { data: asset } = await supabase
      .from("marketing_assets")
      .select("id")
      .eq("id", asset_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!asset) return { error: "Asset tidak ditemukan." };

    const { data: existing } = await supabase
      .from("asset_placements")
      .select("id, event_date, is_registration")
      .eq("asset_id", asset_id)
      .is("deleted_at", null);
    if (id && !(existing ?? []).some((p) => p.id === id)) return { error: "Catatan penempatan tidak ditemukan." };

    // Trigger asset_placements_guard (migrasi 047) tetap jadi penjaga akhir.
    const violation = placementDateViolation(existing ?? [], { id, event_date: data.event_date });
    if (violation) return { error: placementDateMessage(violation) };

    const { data: inserted, error } = id
      ? await supabase
          .from("asset_placements")
          .update(data)
          .eq("id", id)
          .eq("asset_id", asset_id)
          .is("deleted_at", null)
      : await supabase.from("asset_placements").insert({ asset_id, ...data }).select("id").single();
    if (error) return { error: placementErrorMessage(error) };

    revalidateAsset(asset_id);
    return { success: true, id: id ?? inserted?.id };
  } catch {
    return { error: FORBIDDEN };
  }
}

// Hapus = soft delete. Catatan pendaftaran tidak bisa dihapus selama asset
// ada, sehingga menghapus perpindahan terakhir mengembalikan status asset ke
// catatan sebelumnya.
export async function deleteAssetPlacementAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { data: placement } = await supabase
      .from("asset_placements")
      .select("id, asset_id, is_registration")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!placement) return { error: "Catatan penempatan tidak ditemukan." };
    if (placement.is_registration) return { error: REGISTRATION_UNDELETABLE };

    const { error } = await supabase
      .from("asset_placements")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) return { error: placementErrorMessage(error) };

    revalidateAsset(placement.asset_id);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

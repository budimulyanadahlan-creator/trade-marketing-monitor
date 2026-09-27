import type { createClient } from "@/lib/supabase/server";
import {
  POSM_MOVEMENT_LABELS,
  stockStatus,
  type PosmMovementFilters,
  type RekapFilters,
} from "@/lib/posm";
import type { AssetExportRow, PosmExportData, PosmMovementExportRow } from "@/lib/posm-excel";
import { loadPosmOutRekap } from "@/lib/posm-rekap-data";
import { formatDate } from "@/lib/utils";
import { withCampaignRefs } from "@/app/(protected)/monitoring-posm/campaign-refs";
import type { AssetType, PosmMovementType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Batas baris default PostgREST; mutasi diambil per halaman sebesar ini.
const FETCH_PAGE_SIZE = 1000;

type MovementRow = {
  id: string;
  movement_date: string;
  type: PosmMovementType;
  quantity: number;
  notes: string | null;
  campaign_id: string | null;
  item: { code: string; name: string; unit: string } | null;
  region: { name: string } | null;
  distributor: { name: string } | null;
  creator: { full_name: string } | null;
};

/**
 * Semua mutasi sesuai filter daftar mutasi (tanpa paginasi halaman), urutan
 * sama dengan halaman /monitoring-posm/movements.
 */
async function loadMovements(
  supabase: SupabaseServerClient,
  filters: PosmMovementFilters
): Promise<PosmMovementExportRow[]> {
  const rows: MovementRow[] = [];
  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    let query = supabase
      .from("posm_movements")
      .select(
        "id, movement_date, type, quantity, notes, created_at, campaign_id, item:posm_items(code, name, unit), region:regions(name), distributor:distributors(name), creator:created_by(full_name)"
      )
      .is("deleted_at", null);
    if (filters.from) query = query.gte("movement_date", filters.from);
    if (filters.to) query = query.lte("movement_date", filters.to);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.item) query = query.eq("item_id", filters.item);
    if (filters.region) query = query.eq("region_id", filters.region);
    if (filters.distributor) query = query.eq("distributor_id", filters.distributor);

    const { data, error } = await query
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal memuat mutasi POSM: ${error.message}`);
    rows.push(...((data ?? []) as unknown as MovementRow[]));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }

  const withRefs = await withCampaignRefs(supabase, rows);
  return withRefs.map((m) => ({
    movement_date: m.movement_date,
    item_code: m.item?.code ?? "",
    item_name: m.item?.name ?? "",
    unit: m.item?.unit ?? "",
    type: m.type,
    quantity: m.quantity,
    region_name: m.region?.name ?? null,
    distributor_name: m.distributor?.name ?? null,
    campaign_skp: m.campaign_skp,
    campaign_name: m.campaign_name,
    notes: m.notes,
    created_by_name: m.creator?.full_name ?? null,
  }));
}

/** Bagian ringkasan filter mutasi yang aktif, mis. ["Tipe: Keluar", "Region: Jawa Barat"]. */
export function movementFilterParts(
  filters: PosmMovementFilters,
  names: { item: Map<string, string>; region: Map<string, string>; distributor: Map<string, string> }
): string[] {
  const parts: string[] = [];
  if (filters.from || filters.to) {
    parts.push(
      `Tanggal: ${filters.from ? formatDate(filters.from) : "awal"} – ${filters.to ? formatDate(filters.to) : "akhir"}`
    );
  }
  if (filters.type) parts.push(`Tipe: ${POSM_MOVEMENT_LABELS[filters.type]}`);
  if (filters.item) parts.push(`Item: ${names.item.get(filters.item) ?? filters.item}`);
  if (filters.region) parts.push(`Region: ${names.region.get(filters.region) ?? filters.region}`);
  if (filters.distributor) {
    parts.push(`Distributor: ${names.distributor.get(filters.distributor) ?? filters.distributor}`);
  }
  return parts;
}

export function joinFilterLabel(parts: string[]): string {
  return parts.length ? parts.join(" • ") : "Semua mutasi";
}

/**
 * Data export Excel Monitoring POSM. Kueri mengikuti halaman masing-masing
 * (tab POSM, daftar mutasi, rekap, tab Asset) agar angka di file sama
 * dengan yang tampil untuk filter yang sama.
 */
export async function loadPosmExportData(
  supabase: SupabaseServerClient,
  filters: { movements: PosmMovementFilters; rekap: RekapFilters }
): Promise<PosmExportData> {
  const [
    { data: items },
    { data: balances },
    movements,
    rekap,
    { data: assets },
    { data: statuses },
    { data: regions },
    { data: distributors },
  ] = await Promise.all([
    supabase
      .from("posm_items")
      .select("id, code, name, category, unit, min_stock, is_active, brand:brands(name)")
      .is("deleted_at", null)
      .order("code"),
    supabase.from("posm_stock_balances").select("item_id, balance, last_movement_date"),
    loadMovements(supabase, filters.movements),
    loadPosmOutRekap(supabase, filters.rekap),
    supabase
      .from("marketing_assets")
      .select("id, code, name, asset_type, serial_number, acquisition_date, acquisition_value, brand:brands(name)")
      .is("deleted_at", null)
      .order("code"),
    supabase
      .from("asset_current_status")
      .select("asset_id, event_date, destination, region_id, distributor_id, store_name, condition"),
    supabase.from("regions").select("id, name"),
    supabase.from("distributors").select("id, name"),
  ]);

  const balanceByItem = new Map((balances ?? []).map((b) => [b.item_id, b]));
  const regionName = new Map((regions ?? []).map((r) => [r.id, r.name]));
  const distributorName = new Map((distributors ?? []).map((d) => [d.id, d.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, `${i.code} — ${i.name}`]));

  const balanceRows = (items ?? []).map((item) => {
    const b = balanceByItem.get(item.id);
    const balance = b?.balance ?? 0;
    return {
      code: item.code,
      name: item.name,
      brand_name: (item.brand as { name: string } | null)?.name ?? null,
      category: item.category,
      unit: item.unit,
      balance,
      min_stock: item.min_stock,
      stock_status: stockStatus(balance, item.min_stock),
      is_active: item.is_active,
      last_movement_date: b?.last_movement_date ?? null,
    };
  });

  // Kondisi & lokasi dari catatan penempatan terakhir; asset tanpa status
  // dilewati (sama dengan tab Asset).
  const statusByAsset = new Map((statuses ?? []).map((s) => [s.asset_id, s]));
  const assetRows: AssetExportRow[] = (assets ?? []).flatMap((a) => {
    const s = statusByAsset.get(a.id);
    if (!s) return [];
    return [
      {
        code: a.code,
        name: a.name,
        asset_type: a.asset_type as AssetType,
        brand_name: (a.brand as { name: string } | null)?.name ?? null,
        serial_number: a.serial_number,
        acquisition_date: a.acquisition_date,
        acquisition_value: Number(a.acquisition_value),
        condition: s.condition,
        destination: s.destination,
        region_name: s.region_id ? (regionName.get(s.region_id) ?? null) : null,
        distributor_name: s.distributor_id ? (distributorName.get(s.distributor_id) ?? null) : null,
        store_name: s.store_name,
        last_event_date: s.event_date,
      },
    ];
  });

  return {
    balances: balanceRows,
    movements,
    movementFilterLabel: joinFilterLabel(
      movementFilterParts(filters.movements, {
        item: itemName,
        region: regionName,
        distributor: distributorName,
      })
    ),
    rekap,
    assets: assetRows,
  };
}

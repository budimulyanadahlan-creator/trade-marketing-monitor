import type { createClient } from "@/lib/supabase/server";
import { stockStatus } from "@/lib/posm";
import {
  GIMMICK_DESTINATION_LABELS,
  programIlikePattern,
  type GimmickMovementFilters,
  type GimmickRekapFilters,
} from "@/lib/gimmick";
import type { GimmickBalanceExportRow, GimmickExportData, GimmickMovementExportRow } from "@/lib/gimmick-excel";
import { loadGimmickOutMovements } from "@/lib/gimmick-rekap-data";
import { joinFilterLabel, movementFilterParts } from "@/lib/posm-export-data";
import { withCampaignRefs } from "@/app/(protected)/monitoring-posm/campaign-refs";
import type { GimmickCategory, GimmickDestination, GimmickUnit, PosmMovementType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Batas baris default PostgREST; mutasi diambil per halaman sebesar ini.
const FETCH_PAGE_SIZE = 1000;

type MovementRow = {
  id: string;
  movement_date: string;
  type: PosmMovementType;
  quantity: number;
  unit_cost_snapshot: number | string;
  destination: GimmickDestination | null;
  recipient_name: string | null;
  notes: string | null;
  campaign_id: string | null;
  item: { code: string; name: string; unit: string; pcs_per_carton: number | null; program: string | null } | null;
  region: { name: string } | null;
  distributor: { name: string } | null;
  creator: { full_name: string } | null;
};

/**
 * Semua mutasi gimmick sesuai filter daftar mutasi (tanpa paginasi halaman),
 * urutan sama dengan halaman /monitoring-posm/gimmick/movements.
 */
async function loadMovements(
  supabase: SupabaseServerClient,
  filters: GimmickMovementFilters
): Promise<GimmickMovementExportRow[]> {
  const rows: MovementRow[] = [];
  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    // !inner agar filter program (kolom item) menyaring mutasi.
    let query = supabase
      .from("gimmick_movements")
      .select(
        "id, movement_date, type, quantity, unit_cost_snapshot, destination, recipient_name, notes, created_at, campaign_id, item:gimmick_items!inner(code, name, unit, pcs_per_carton, program), region:regions(name), distributor:distributors(name), creator:created_by(full_name)"
      )
      .is("deleted_at", null);
    if (filters.from) query = query.gte("movement_date", filters.from);
    if (filters.to) query = query.lte("movement_date", filters.to);
    if (filters.type) query = query.eq("type", filters.type);
    if (filters.destination) query = query.eq("destination", filters.destination);
    if (filters.item) query = query.eq("item_id", filters.item);
    if (filters.region) query = query.eq("region_id", filters.region);
    if (filters.distributor) query = query.eq("distributor_id", filters.distributor);
    if (filters.program) query = query.ilike("item.program", programIlikePattern(filters.program));

    const { data, error } = await query
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal memuat mutasi gimmick: ${error.message}`);
    rows.push(...((data ?? []) as unknown as MovementRow[]));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }

  // Label SKP lewat gimmick_campaign_refs (khusus can_manage_posm()).
  const withRefs = await withCampaignRefs(supabase, rows, "gimmick_campaign_refs");
  return withRefs.map((m) => ({
    movement_date: m.movement_date,
    item_code: m.item?.code ?? "",
    item_name: m.item?.name ?? "",
    program: m.item?.program ?? null,
    unit: m.item?.unit ?? "",
    pcs_per_carton: m.item?.pcs_per_carton ?? null,
    type: m.type,
    quantity: m.quantity,
    unit_cost_snapshot: Number(m.unit_cost_snapshot),
    destination: m.destination,
    region_name: m.region?.name ?? null,
    distributor_name: m.distributor?.name ?? null,
    campaign_skp: m.campaign_skp,
    campaign_name: m.campaign_name,
    recipient_name: m.recipient_name,
    notes: m.notes,
    created_by_name: m.creator?.full_name ?? null,
  }));
}

/**
 * Data sheet gimmick di export Monitoring POSM. Hanya dipanggil untuk
 * pemegang can_manage_posm() (RLS tabel gimmick juga menolak pembaca lain).
 * Kueri mengikuti tab Gimmick, daftar mutasi, dan halaman rekap agar angka
 * di file sama dengan layar untuk filter yang sama.
 */
export async function loadGimmickExportData(
  supabase: SupabaseServerClient,
  filters: { movements: GimmickMovementFilters; rekap: GimmickRekapFilters }
): Promise<GimmickExportData> {
  const [{ data: items }, { data: balances }, movements, rekap, { data: regions }, { data: distributors }] =
    await Promise.all([
      supabase
        .from("gimmick_items")
        .select("id, code, name, program, category, unit, pcs_per_carton, unit_cost, min_stock, is_active, brand:brands(name)")
        .is("deleted_at", null)
        .order("code"),
      supabase.from("gimmick_stock_balances").select("item_id, balance, last_movement_date, stock_value"),
      loadMovements(supabase, filters.movements),
      loadGimmickOutMovements(supabase, filters.rekap),
      supabase.from("regions").select("id, name"),
      supabase.from("distributors").select("id, name"),
    ]);

  const balanceByItem = new Map((balances ?? []).map((b) => [b.item_id, b]));
  const itemName = new Map((items ?? []).map((i) => [i.id, `${i.code} — ${i.name}`]));

  const balanceRows: GimmickBalanceExportRow[] = (items ?? []).map((item) => {
    const b = balanceByItem.get(item.id);
    const balance = b?.balance ?? 0;
    return {
      code: item.code,
      name: item.name,
      program: item.program,
      brand_name: (item.brand as { name: string } | null)?.name ?? null,
      category: item.category as GimmickCategory,
      unit: item.unit as GimmickUnit,
      pcs_per_carton: item.pcs_per_carton,
      balance,
      unit_cost: Number(item.unit_cost),
      stock_value: Number(b?.stock_value ?? 0),
      min_stock: item.min_stock,
      stock_status: stockStatus(balance, item.min_stock),
      is_active: item.is_active,
      last_movement_date: b?.last_movement_date ?? null,
    };
  });

  const { destination, program } = filters.movements;
  const movementParts = movementFilterParts(filters.movements, {
    item: itemName,
    region: new Map((regions ?? []).map((r) => [r.id, r.name])),
    distributor: new Map((distributors ?? []).map((d) => [d.id, d.name])),
  });
  if (destination) movementParts.push(`Tujuan: ${GIMMICK_DESTINATION_LABELS[destination]}`);
  if (program) movementParts.push(`Program: ${program}`);

  const rekapParts: string[] = [];
  if (filters.rekap.item) rekapParts.push(`Item: ${itemName.get(filters.rekap.item) ?? filters.rekap.item}`);
  if (filters.rekap.program) rekapParts.push(`Program: ${filters.rekap.program}`);

  return {
    balances: balanceRows,
    movements,
    movementFilterLabel: joinFilterLabel(movementParts),
    rekap: { ...rekap, filterLabel: rekapParts.join(" • ") },
  };
}

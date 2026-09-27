import type { createClient } from "@/lib/supabase/server";
import { monthDateBounds, monthRange } from "@/lib/posm";
import type { GimmickRekapFilters, GimmickRekapMovement } from "@/lib/gimmick";
import type { GimmickDestination, PosmMovementType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Batas baris default PostgREST; mutasi diambil per halaman sebesar ini.
const FETCH_PAGE_SIZE = 1000;

type OutMovementRow = {
  item_id: string;
  region_id: string | null;
  destination: GimmickDestination | null;
  movement_date: string;
  type: PosmMovementType;
  quantity: number;
  unit_cost_snapshot: number | string;
  item: { code: string; name: string; unit: string; program: string | null } | null;
  region: { name: string } | null;
};

export type GimmickRekapData = { months: string[]; movements: GimmickRekapMovement[] };

// Sumber data tunggal rekap gimmick keluar — dipakai halaman rekap dan
// (nanti) export Excel, supaya angka di kedua tempat identik. Mengembalikan
// mutasi mentah agar ketiga rekap dan kedua mode dihitung dari data yang sama.
export async function loadGimmickOutMovements(
  supabase: SupabaseServerClient,
  filters: GimmickRekapFilters
): Promise<GimmickRekapData> {
  const months = monthRange(filters.from, filters.to);
  const { start, end } = monthDateBounds(filters.from, filters.to);

  const rows: OutMovementRow[] = [];
  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    // !inner agar filter program (kolom item) menyaring mutasi.
    let query = supabase
      .from("gimmick_movements")
      .select(
        "id, item_id, region_id, destination, movement_date, type, quantity, unit_cost_snapshot, item:gimmick_items!inner(code, name, unit, program), region:regions(name)"
      )
      .eq("type", "out")
      .is("deleted_at", null)
      .gte("movement_date", start)
      .lte("movement_date", end);
    if (filters.item) query = query.eq("item_id", filters.item);
    if (filters.program) query = query.eq("item.program", filters.program);

    const { data, error } = await query.order("id").range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal memuat rekap gimmick: ${error.message}`);
    rows.push(...((data ?? []) as unknown as OutMovementRow[]));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }

  const movements: GimmickRekapMovement[] = rows.map((m) => ({
    item_id: m.item_id,
    item_code: m.item?.code ?? "",
    item_name: m.item?.name ?? "",
    unit: m.item?.unit ?? "",
    program: m.item?.program ?? null,
    region_id: m.region_id,
    region_name: m.region?.name ?? null,
    destination: m.destination,
    movement_date: m.movement_date,
    type: m.type,
    quantity: m.quantity,
    unit_cost_snapshot: Number(m.unit_cost_snapshot),
  }));

  return { months, movements };
}

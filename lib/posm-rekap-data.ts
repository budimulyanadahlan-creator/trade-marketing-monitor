import type { createClient } from "@/lib/supabase/server";
import {
  aggregateOutRekap,
  monthDateBounds,
  monthRange,
  type OutRekap,
  type RekapFilters,
  type RekapMovement,
} from "@/lib/posm";
import type { PosmMovementType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Batas baris default PostgREST; mutasi diambil per halaman sebesar ini.
const FETCH_PAGE_SIZE = 1000;

type OutMovementRow = {
  item_id: string;
  region_id: string | null;
  movement_date: string;
  type: PosmMovementType;
  quantity: number;
  item: { code: string; name: string; unit: string } | null;
  region: { name: string } | null;
};

export type PosmRekapData = OutRekap & { months: string[] };

// Sumber data tunggal rekap POSM keluar — dipakai halaman rekap dan (nanti)
// export Excel, supaya angka di kedua tempat identik.
export async function loadPosmOutRekap(
  supabase: SupabaseServerClient,
  filters: RekapFilters
): Promise<PosmRekapData> {
  const months = monthRange(filters.from, filters.to);
  const { start, end } = monthDateBounds(filters.from, filters.to);

  const rows: OutMovementRow[] = [];
  for (let offset = 0; ; offset += FETCH_PAGE_SIZE) {
    let query = supabase
      .from("posm_movements")
      .select(
        "id, item_id, region_id, movement_date, type, quantity, item:posm_items!inner(code, name, unit, brand_id), region:regions(name)"
      )
      .eq("type", "out")
      .is("deleted_at", null)
      .gte("movement_date", start)
      .lte("movement_date", end);
    if (filters.item) query = query.eq("item_id", filters.item);
    if (filters.brand) query = query.eq("item.brand_id", filters.brand);

    const { data, error } = await query.order("id").range(offset, offset + FETCH_PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal memuat rekap POSM: ${error.message}`);
    rows.push(...((data ?? []) as unknown as OutMovementRow[]));
    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }

  const movements: RekapMovement[] = rows.map((m) => ({
    item_id: m.item_id,
    item_code: m.item?.code ?? "",
    item_name: m.item?.name ?? "",
    unit: m.item?.unit ?? "",
    region_id: m.region_id,
    region_name: m.region?.name ?? null,
    movement_date: m.movement_date,
    type: m.type,
    quantity: m.quantity,
  }));

  return { months, ...aggregateOutRekap(movements, months) };
}

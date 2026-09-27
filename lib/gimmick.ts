/**
 * Logika murni Monitoring Gimmick (plans/prd-monitoring-gimmick.md).
 */

import type { GimmickCategory, GimmickDestination, GimmickUnit, PosmMovementType } from "@/types/database";
import {
  movementFiltersQuery,
  parseMovementFilters,
  stockStatus,
  withRunningBalance,
  type BalanceMovement,
  type PosmMovementFilters,
} from "@/lib/posm";

// Daftar tetap — harus sama dengan check constraint gimmick_items (migrasi 050).
export const GIMMICK_CATEGORIES: readonly GimmickCategory[] = [
  "Payung",
  "Tas",
  "Botol/Gelas",
  "Mainan",
  "Pakaian",
  "Alat Tulis",
  "Lainnya",
];
export const GIMMICK_UNITS: readonly GimmickUnit[] = ["pcs", "set"];

export const GIMMICK_CODE_PREFIX = "GMK";

// Label tipe memakai POSM_MOVEMENT_LABELS.
export const GIMMICK_MOVEMENT_TYPES = ["opening", "in", "out", "adjustment"] as const satisfies readonly PosmMovementType[];

// Tujuan Keluar — harus sama dengan check constraint gimmick_movements (migrasi 051).
export const GIMMICK_DESTINATIONS = ["region_distributor", "event", "internal", "other"] as const satisfies readonly GimmickDestination[];

export const GIMMICK_DESTINATION_LABELS: Record<GimmickDestination, string> = {
  region_distributor: "Region/Distributor",
  event: "Event/Pameran",
  internal: "Internal",
  other: "Lainnya",
};

// ============================================================
// TUJUAN KELUAR
// ============================================================

export type GimmickDestinationFields = {
  destination: GimmickDestination | null;
  region_id: string | null;
  distributor_id: string | null;
  campaign_id: string | null;
  recipient_name: string | null;
};

const NOTES_REQUIRED: Record<Exclude<GimmickDestination, "region_distributor">, string> = {
  event: "Nama event harus diisi",
  internal: "Keterangan keperluan internal harus diisi",
  other: "Keterangan harus diisi",
};

/**
 * Kolom tujuan yang disimpan untuk sebuah mutasi, atau pesan error jika
 * field wajib kosong. Aturannya sama dengan check constraint migrasi 051:
 * - Region/Distributor: region wajib, distributor opsional
 * - Event/Pameran: keterangan wajib, region opsional
 * - Internal/Lainnya: keterangan wajib, tanpa region/distributor
 * SKP dan PIC opsional untuk semua tujuan. Selain Keluar, semua kolom tujuan
 * dikosongkan (mis. saat mutasi Keluar diedit menjadi Masuk).
 */
export function gimmickDestination(v: {
  type: PosmMovementType;
  destination?: GimmickDestination;
  region_id?: string;
  distributor_id?: string;
  campaign_id?: string;
  recipient_name?: string;
  notes?: string;
}): { error: string } | { fields: GimmickDestinationFields } {
  const empty = { destination: null, region_id: null, distributor_id: null, campaign_id: null, recipient_name: null };
  if (v.type !== "out") return { fields: empty };
  if (!v.destination) return { error: "Pilih tujuan keluar" };

  if (v.destination === "region_distributor") {
    if (!v.region_id) return { error: "Region tujuan harus diisi" };
  } else if (!v.notes?.trim()) {
    return { error: NOTES_REQUIRED[v.destination] };
  }

  return {
    fields: {
      destination: v.destination,
      region_id: v.destination === "region_distributor" || v.destination === "event" ? (v.region_id ?? null) : null,
      distributor_id: v.destination === "region_distributor" ? (v.distributor_id ?? null) : null,
      campaign_id: v.campaign_id ?? null,
      recipient_name: v.recipient_name?.trim() || null,
    },
  };
}

/**
 * Pilihan autocomplete program/periode: nilai yang pernah diinput, sekali
 * per nama (tanpa membedakan huruf besar/kecil), urut abjad.
 */
export function distinctPrograms(items: { program: string | null }[]): string[] {
  const byKey = new Map<string, string>();
  for (const { program } of items) {
    const value = program?.trim();
    if (value && !byKey.has(value.toLowerCase())) byKey.set(value.toLowerCase(), value);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "id"));
}

// ============================================================
// AKSES TAB
// ============================================================

export type MonitoringPosmTab = "posm" | "asset" | "gimmick";

const TABS: { value: MonitoringPosmTab; label: string }[] = [
  { value: "posm", label: "POSM" },
  { value: "asset", label: "Asset" },
  { value: "gimmick", label: "Gimmick" },
];

/** Tab yang ditampilkan: Gimmick hanya untuk pemegang can_manage_posm(). */
export function monitoringPosmTabs(canManage: boolean) {
  return TABS.filter((t) => t.value !== "gimmick" || canManage);
}

/**
 * Tab aktif dari query string. Tab Gimmick hanya untuk pemegang
 * can_manage_posm(); user lain yang membukanya diarahkan ke tab POSM.
 */
export function resolveMonitoringPosmTab(
  tab: string | string[] | undefined,
  canManage: boolean
): MonitoringPosmTab {
  const value = Array.isArray(tab) ? tab[0] : tab;
  if (value === "asset") return "asset";
  if (value === "gimmick" && canManage) return "gimmick";
  return "posm";
}

// ============================================================
// KARTON ↔ PCS
// ============================================================
// Stok selalu disimpan dalam pcs (satuan item); karton hanya untuk input
// dan tampilan, sehingga isi/karton bisa diubah tanpa merusak riwayat.

/** Total pcs dari input karton + pcs. Karton diabaikan jika item tanpa isi/karton. */
export function cartonsToPcs(
  { cartons, pcs }: { cartons: number; pcs: number },
  pcsPerCarton: number | null
): number {
  return (pcsPerCarton ? cartons * pcsPerCarton : 0) + pcs;
}

/** Karton penuh dan sisa pcs dari total pcs (nilai absolut). */
export function pcsToCartons(qty: number, pcsPerCarton: number): { cartons: number; pcs: number } {
  const magnitude = Math.abs(qty);
  return { cartons: Math.floor(magnitude / pcsPerCarton), pcs: magnitude % pcsPerCarton };
}

/** "77 pcs (3 krt + 5 pcs)"; rincian karton hanya jika minimal satu karton. */
export function formatPcsWithCartons(qty: number, pcsPerCarton: number | null, unit: string): string {
  const total = `${qty.toLocaleString("id-ID")} ${unit}`;
  if (!pcsPerCarton) return total;
  const { cartons, pcs } = pcsToCartons(qty, pcsPerCarton);
  if (cartons === 0) return total;
  const breakdown = `${cartons.toLocaleString("id-ID")} krt${pcs ? ` + ${pcs} ${unit}` : ""}`;
  return `${total} (${breakdown})`;
}

// ============================================================
// SALDO & NILAI
// ============================================================
// Nilai stok saat ini = saldo × harga master terbaru. Nilai transaksi =
// qty × unit_cost_snapshot (tetap walau harga master berubah).

export type GimmickStockSummary = {
  activeItems: number;
  lowStock: number;
  outOfStock: number;
  totalValue: number;
};

/**
 * Kartu ringkasan tab Gimmick. Status stok dihitung untuk item aktif saja
 * (seperti POSM), sedangkan nilai stok mencakup semua item karena stok item
 * nonaktif masih ada di gudang.
 */
export function summarizeGimmickStock(
  items: { is_active: boolean; balance: number; min_stock: number | null; unit_cost: number }[]
): GimmickStockSummary {
  const summary: GimmickStockSummary = { activeItems: 0, lowStock: 0, outOfStock: 0, totalValue: 0 };
  for (const item of items) {
    summary.totalValue += item.balance * item.unit_cost;
    if (!item.is_active) continue;
    summary.activeItems += 1;
    const status = stockStatus(item.balance, item.min_stock);
    if (status === "menipis") summary.lowStock += 1;
    if (status === "habis") summary.outOfStock += 1;
  }
  return summary;
}

/** Kartu "nilai keluar bulan ini": Σ |qty| × harga snapshot mutasi Keluar di bulan `YYYY-MM`. */
export function outValueInMonth(
  movements: { type: PosmMovementType; movement_date: string; quantity: number; unit_cost_snapshot: number }[],
  month: string
): number {
  return movements
    .filter((m) => m.type === "out" && m.movement_date.startsWith(`${month}-`))
    .reduce((sum, m) => sum + Math.abs(m.quantity) * m.unit_cost_snapshot, 0);
}

/** Riwayat mutasi kronologis dengan saldo berjalan dan nilai Rp per transaksi. */
export function withRunningValue<
  T extends BalanceMovement & { created_at: string; unit_cost_snapshot: number },
>(movements: T[]): (T & { running_balance: number; value: number })[] {
  return withRunningBalance(movements).map((m) => ({ ...m, value: m.quantity * m.unit_cost_snapshot }));
}

// ============================================================
// DAFTAR MUTASI (filter di query string)
// ============================================================
// Filter POSM (periode, tipe, item, region, distributor, halaman) ditambah
// tujuan Keluar dan program item.

export type GimmickMovementFilters = PosmMovementFilters & {
  destination?: GimmickDestination;
  program?: string;
};

/** Nilai filter yang tidak valid diabaikan agar query tidak gagal. */
export function parseGimmickMovementFilters(
  params: Record<string, string | string[] | undefined>
): GimmickMovementFilters {
  const filters: GimmickMovementFilters = parseMovementFilters(params);
  const destination = params.destination;
  if (GIMMICK_DESTINATIONS.includes(destination as GimmickDestination))
    filters.destination = destination as GimmickDestination;
  const program = typeof params.program === "string" ? params.program.trim() : "";
  if (program) filters.program = program;
  return filters;
}

/** Query string untuk filter (halaman 1 dan nilai kosong dihilangkan). */
export function gimmickMovementFiltersQuery(filters: Partial<GimmickMovementFilters>): string {
  const params = new URLSearchParams(movementFiltersQuery({ ...filters, page: 1 }));
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.program) params.set("program", filters.program);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

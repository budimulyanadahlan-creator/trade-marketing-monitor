/**
 * Logika murni Monitoring Gimmick (plans/prd-monitoring-gimmick.md).
 */

import type { GimmickCategory, GimmickUnit } from "@/types/database";
import { stockStatus, withRunningBalance, type BalanceMovement } from "@/lib/posm";

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

// Tipe mutasi yang bisa diinput. Keluar (dengan tujuan) menyusul di fase 3;
// label memakai POSM_MOVEMENT_LABELS.
export const GIMMICK_MOVEMENT_TYPES = ["opening", "in", "adjustment"] as const;

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

/** Riwayat mutasi kronologis dengan saldo berjalan dan nilai Rp per transaksi. */
export function withRunningValue<
  T extends BalanceMovement & { created_at: string; unit_cost_snapshot: number },
>(movements: T[]): (T & { running_balance: number; value: number })[] {
  return withRunningBalance(movements).map((m) => ({ ...m, value: m.quantity * m.unit_cost_snapshot }));
}

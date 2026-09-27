/**
 * Logika murni Monitoring Gimmick (plans/prd-monitoring-gimmick.md).
 */

import type { GimmickCategory, GimmickUnit } from "@/types/database";

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

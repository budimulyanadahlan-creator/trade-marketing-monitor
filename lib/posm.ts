/**
 * Logika murni Monitoring POSM & Asset (plans/prd-monitoring-posm-asset.md).
 */

import type { PosmCategory, PosmMovementType, PosmUnit, UserRole } from "@/types/database";

// Daftar tetap — harus sama dengan check constraint posm_items (migrasi 043).
export const POSM_CATEGORIES: readonly PosmCategory[] = [
  "Poster",
  "Wobbler",
  "Shelf Talker",
  "Hanger",
  "Banner",
  "Sticker",
  "Lainnya",
];
export const POSM_UNITS: readonly PosmUnit[] = ["pcs", "lembar", "roll", "set"];

export const POSM_CODE_PREFIX = "POSM";

// Harus sama dengan fungsi database public.can_manage_posm() (migrasi 043).
const POSM_WRITER_DEPARTMENTS = ["marketing", "trade marketing"];

/**
 * Hak tulis POSM/asset: departemen Marketing atau Trade Marketing (role apa
 * pun kecuali distributor), atau role admin/superadmin.
 */
export function canManagePosm({
  role,
  departmentName,
}: {
  role: UserRole;
  departmentName: string | null | undefined;
}): boolean {
  if (role === "distributor") return false;
  if (role === "admin" || role === "superadmin") return true;
  return POSM_WRITER_DEPARTMENTS.includes((departmentName ?? "").trim().toLowerCase());
}

/**
 * Kode otomatis berikutnya: nomor setelah kode berformat standar
 * (`PREFIX-0001`) terbesar. Kode manual yang tidak berformat standar
 * diabaikan.
 */
export function nextCode(prefix: string, existingCodes: string[]): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const code of existingCodes) {
    const match = pattern.exec(code.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

// ============================================================
// SALDO & STATUS STOK
// ============================================================

export type PosmStockStatus = "aman" | "menipis" | "habis";

/** Habis (saldo 0), Menipis (saldo ≤ stok minimum), selain itu Aman. */
export function stockStatus(balance: number, minStock: number | null): PosmStockStatus {
  if (balance <= 0) return "habis";
  if (minStock !== null && balance <= minStock) return "menipis";
  return "aman";
}

// ============================================================
// MUTASI STOK
// ============================================================

export const POSM_MOVEMENT_TYPES: readonly PosmMovementType[] = ["opening", "in", "out", "adjustment"];

export const POSM_MOVEMENT_LABELS: Record<PosmMovementType, string> = {
  opening: "Saldo Awal",
  in: "Masuk",
  out: "Keluar",
  adjustment: "Penyesuaian",
};

export type AdjustmentDirection = "plus" | "minus";

/**
 * Pengguna selalu mengisi qty positif; tanda ditentukan tipe: Saldo Awal &
 * Masuk positif, Keluar negatif, Penyesuaian mengikuti arah plus/minus.
 */
export function signedQuantity(
  type: PosmMovementType,
  quantity: number,
  direction: AdjustmentDirection = "plus"
): number {
  const magnitude = Math.abs(quantity);
  if (type === "out") return -magnitude;
  if (type === "adjustment" && direction === "minus") return -magnitude;
  return magnitude;
}

// ============================================================
// SALDO BERJALAN
// ============================================================
// Harus sama dengan trigger posm_validate_running_balance() (migrasi 044):
// saldo dihitung per akhir hari (mutasi di tanggal yang sama saling
// menetralkan tanpa melihat urutan input), dan tidak boleh negatif di
// tanggal mana pun.

export type BalanceMovement = { movement_date: string; quantity: number };

export function balanceOf(movements: BalanceMovement[]): number {
  return movements.reduce((sum, m) => sum + m.quantity, 0);
}

/** Saldo kumulatif per akhir hari, urut tanggal naik. */
function endOfDayBalances(movements: BalanceMovement[]): { date: string; balance: number }[] {
  const byDate = new Map<string, number>();
  for (const m of movements) byDate.set(m.movement_date, (byDate.get(m.movement_date) ?? 0) + m.quantity);

  let balance = 0;
  return [...byDate.keys()].sort().map((date) => {
    balance += byDate.get(date)!;
    return { date, balance };
  });
}

/** Tanggal pertama saat saldo akhir hari negatif, atau null jika aman. */
export function findBalanceViolation(
  movements: BalanceMovement[]
): { date: string; balance: number } | null {
  return endOfDayBalances(movements).find((d) => d.balance < 0) ?? null;
}

/**
 * Qty maksimum yang bisa dikeluarkan pada `date` tanpa membuat saldo
 * negatif di tanggal itu maupun sesudahnya.
 */
export function availableFrom(movements: BalanceMovement[], date: string): number {
  const days = endOfDayBalances(movements);
  let min = balanceOf(movements.filter((m) => m.movement_date <= date));
  for (const d of days) if (d.date > date) min = Math.min(min, d.balance);
  return Math.max(0, min);
}

/** Riwayat mutasi urut tanggal lalu urutan input, dengan saldo berjalan. */
export function withRunningBalance<T extends BalanceMovement & { created_at: string }>(
  movements: T[]
): (T & { running_balance: number })[] {
  let balance = 0;
  return [...movements]
    .sort(
      (a, b) =>
        a.movement_date.localeCompare(b.movement_date) || a.created_at.localeCompare(b.created_at)
    )
    .map((m) => ({ ...m, running_balance: (balance += m.quantity) }));
}

// ============================================================
// DAFTAR MUTASI (filter di query string)
// ============================================================

export const POSM_MOVEMENTS_PAGE_SIZE = 50;

export type PosmMovementFilters = {
  from?: string;
  to?: string;
  type?: PosmMovementType;
  item?: string;
  region?: string;
  distributor?: string;
  page: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nilai filter yang tidak valid diabaikan agar query tidak gagal. */
export function parseMovementFilters(
  params: Record<string, string | string[] | undefined>
): PosmMovementFilters {
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v.trim() : undefined;
  };
  const matching = (key: string, pattern: RegExp) => {
    const v = one(key);
    return v && pattern.test(v) ? v : undefined;
  };

  const type = one("type");
  const page = Number(one("page"));
  const filters: PosmMovementFilters = {
    from: matching("from", ISO_DATE),
    to: matching("to", ISO_DATE),
    type: POSM_MOVEMENT_TYPES.includes(type as PosmMovementType) ? (type as PosmMovementType) : undefined,
    item: matching("item", UUID),
    region: matching("region", UUID),
    distributor: matching("distributor", UUID),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined)
  ) as PosmMovementFilters;
}

/** Query string untuk filter (halaman 1 dan nilai kosong dihilangkan). */
export function movementFiltersQuery(filters: Partial<PosmMovementFilters>): string {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "type", "item", "region", "distributor"] as const) {
    const v = filters[key];
    if (v) params.set(key, v);
  }
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

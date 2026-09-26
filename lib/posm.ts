/**
 * Logika murni Monitoring POSM & Asset (plans/prd-monitoring-posm-asset.md).
 */

import type {
  AssetCondition,
  AssetDestination,
  AssetType,
  PosmCategory,
  PosmMovementType,
  PosmUnit,
  UserRole,
} from "@/types/database";

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

// ============================================================
// REKAP POSM KELUAR PER REGION PER BULAN
// ============================================================

export type RekapMovement = {
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  region_id: string | null;
  region_name: string | null;
  movement_date: string;
  type: PosmMovementType;
  quantity: number;
};

export type RekapRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  region_id: string | null;
  region_name: string | null;
  /** Total qty keluar per bulan, sejajar dengan `months`. */
  months: number[];
  total: number;
};

export type OutRekap = { rows: RekapRow[]; monthTotals: number[]; grandTotal: number };

/**
 * Matriks item × region × bulan dari mutasi Keluar (nilai absolut). Tipe
 * lain dan mutasi di luar `months` (format `YYYY-MM`) diabaikan. Hanya
 * kombinasi item-region yang punya pengiriman yang menjadi baris.
 */
export function aggregateOutRekap(movements: RekapMovement[], months: string[]): OutRekap {
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<string, RekapRow>();

  for (const m of movements) {
    if (m.type !== "out") continue;
    const i = monthIndex.get(m.movement_date.slice(0, 7));
    if (i === undefined) continue;

    const key = `${m.item_id}|${m.region_id ?? ""}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        item_id: m.item_id,
        item_code: m.item_code,
        item_name: m.item_name,
        unit: m.unit,
        region_id: m.region_id,
        region_name: m.region_name,
        months: months.map(() => 0),
        total: 0,
      };
      rows.set(key, row);
    }
    const qty = Math.abs(m.quantity);
    row.months[i] += qty;
    row.total += qty;
  }

  const sorted = [...rows.values()].sort(
    (a, b) =>
      a.item_code.localeCompare(b.item_code) || (a.region_name ?? "").localeCompare(b.region_name ?? "")
  );
  const monthTotals = months.map((_, i) => sorted.reduce((sum, r) => sum + r.months[i], 0));
  return { rows: sorted, monthTotals, grandTotal: monthTotals.reduce((a, b) => a + b, 0) };
}

// Filter rekap (query string): rentang bulan `YYYY-MM`, item, dan brand.

export const REKAP_DEFAULT_MONTHS = 6;
export const REKAP_MAX_MONTHS = 24;

export type RekapFilters = { from: string; to: string; item?: string; brand?: string };

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function toMonthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

function fromMonthIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Semua bulan dari `from` sampai `to` (inklusif). */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let i = toMonthIndex(from); i <= toMonthIndex(to); i++) months.push(fromMonthIndex(i));
  return months;
}

/** Tanggal pertama dan terakhir rentang bulan, untuk filter movement_date. */
export function monthDateBounds(from: string, to: string): { start: string; end: string } {
  const [y, m] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${from}-01`, end: `${to}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * Default 6 bulan terakhir termasuk bulan `today`. Rentang terbalik ditukar,
 * dan rentang lebih dari 24 bulan dipotong dari bulan akhir ke belakang.
 */
export function parseRekapFilters(
  params: Record<string, string | string[] | undefined>,
  today: string
): RekapFilters {
  const one = (key: string, pattern: RegExp) => {
    const v = params[key];
    return typeof v === "string" && pattern.test(v.trim()) ? v.trim() : undefined;
  };

  const current = today.slice(0, 7);
  let from = one("from", YEAR_MONTH);
  let to = one("to", YEAR_MONTH);
  if (!from && !to) {
    to = current;
    from = fromMonthIndex(toMonthIndex(current) - (REKAP_DEFAULT_MONTHS - 1));
  }
  from ??= to!;
  to ??= from;
  if (from > to) [from, to] = [to, from];
  const earliest = toMonthIndex(to) - (REKAP_MAX_MONTHS - 1);
  if (toMonthIndex(from) < earliest) from = fromMonthIndex(earliest);

  const filters: RekapFilters = { from, to, item: one("item", UUID), brand: one("brand", UUID) };
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as RekapFilters;
}

// ============================================================
// ASSET MARKETING
// ============================================================

// Daftar tetap — harus sama dengan check constraint marketing_assets dan
// asset_placements (migrasi 046).
export const ASSET_TYPES: readonly AssetType[] = [
  "Cooler/Chiller",
  "Rak Display",
  "Gondola",
  "Standing Banner",
  "Tenda/Booth",
  "Lainnya",
];
export const ASSET_CONDITIONS: readonly AssetCondition[] = [
  "Baik",
  "Rusak Ringan",
  "Rusak Berat",
  "Hilang",
  "Dihapusbukukan",
];
export const ASSET_DESTINATION_LABELS: Record<AssetDestination, string> = {
  warehouse: "Gudang Pusat",
  placed: "Ditempatkan",
};

export const ASSET_CODE_PREFIX = "AST";

export type AssetSummaryInput = {
  acquisition_value: number;
  condition: AssetCondition;
  destination: AssetDestination;
};

export type AssetSummary = {
  totalUnits: number;
  totalValue: number;
  byCondition: Record<AssetCondition, number>;
  inWarehouse: number;
  placed: number;
};

/** Kartu ringkas tab Asset; kondisi & lokasi dari penempatan terakhir. */
export function summarizeAssets(assets: AssetSummaryInput[]): AssetSummary {
  const byCondition = Object.fromEntries(ASSET_CONDITIONS.map((c) => [c, 0])) as Record<AssetCondition, number>;
  let totalValue = 0;
  let inWarehouse = 0;
  for (const a of assets) {
    totalValue += Number(a.acquisition_value);
    byCondition[a.condition] += 1;
    if (a.destination === "warehouse") inWarehouse += 1;
  }
  return { totalUnits: assets.length, totalValue, byCondition, inWarehouse, placed: assets.length - inWarehouse };
}

/**
 * Logika murni Monitoring POSM & Asset (plans/prd-monitoring-posm-asset.md).
 */

import type {
  AssetCondition,
  AssetDestination,
  AssetType,
  GimmickDestination,
  PosmAuditAction,
  PosmCategory,
  PosmMovementType,
  PosmUnit,
  UserRole,
} from "@/types/database";
import { formatDate, formatIDR } from "@/lib/utils";

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

/** Label bulan `YYYY-MM` gaya Indonesia, mis. "Agu 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("id-ID", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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
// EXPORT EXCEL
// ============================================================
// Filter mutasi memakai kunci yang sama dengan halaman daftar mutasi; filter
// rekap diberi awalan `rekap_` karena `from`/`to` bentrok.

const REKAP_EXPORT_PREFIX = "rekap_";

export function posmExportHref({
  movements,
  rekap,
}: {
  movements?: Partial<PosmMovementFilters>;
  rekap?: Partial<RekapFilters>;
}): string {
  const params = new URLSearchParams(movementFiltersQuery({ ...movements, page: 1 }));
  for (const key of ["from", "to", "item", "brand"] as const) {
    const v = rekap?.[key];
    if (v) params.set(`${REKAP_EXPORT_PREFIX}${key}`, v);
  }
  const qs = params.toString();
  return `/api/export/monitoring-posm${qs ? `?${qs}` : ""}`;
}

export function parsePosmExportParams(
  params: Record<string, string | string[] | undefined>,
  today: string
): { movements: PosmMovementFilters; rekap: RekapFilters } {
  const rekapParams = Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => key.startsWith(REKAP_EXPORT_PREFIX))
      .map(([key, v]) => [key.slice(REKAP_EXPORT_PREFIX.length), v])
  );
  return {
    movements: { ...parseMovementFilters(params), page: 1 },
    rekap: parseRekapFilters(rekapParams, today),
  };
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

// Tujuan Keluar gimmick (dipakai ulang lib/gimmick dan audit log).
export const GIMMICK_DESTINATION_LABELS: Record<GimmickDestination, string> = {
  region_distributor: "Region/Distributor",
  event: "Event/Pameran",
  internal: "Internal",
  other: "Lainnya",
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

export const ASSET_WRITTEN_OFF: AssetCondition = "Dihapusbukukan";

/**
 * Kartu ringkas tab Asset; kondisi & lokasi dari penempatan terakhir. Asset
 * Dihapusbukukan tidak ikut total unit, nilai, dan lokasi (sama dengan
 * tampilan default tabel), tetapi tetap dihitung per kondisi.
 */
export function summarizeAssets(assets: AssetSummaryInput[]): AssetSummary {
  const byCondition = Object.fromEntries(ASSET_CONDITIONS.map((c) => [c, 0])) as Record<AssetCondition, number>;
  let totalUnits = 0;
  let totalValue = 0;
  let inWarehouse = 0;
  for (const a of assets) {
    byCondition[a.condition] += 1;
    if (a.condition === ASSET_WRITTEN_OFF) continue;
    totalUnits += 1;
    totalValue += Number(a.acquisition_value);
    if (a.destination === "warehouse") inWarehouse += 1;
  }
  return { totalUnits, totalValue, byCondition, inWarehouse, placed: totalUnits - inWarehouse };
}

// ============================================================
// RIWAYAT PENEMPATAN ASSET
// ============================================================
// Urutan harus sama dengan view asset_current_status (migrasi 047): tanggal,
// lalu pendaftaran lebih dulu, lalu urutan input.

type PlacementOrderKey = { event_date: string; is_registration: boolean; created_at: string };

/** Riwayat urut kronologis; setiap catatan menyimpan catatan sebelumnya (asal). */
export function withPreviousPlacement<T extends PlacementOrderKey>(
  placements: T[]
): (T & { previous: T | null })[] {
  const sorted = [...placements].sort(
    (a, b) =>
      a.event_date.localeCompare(b.event_date) ||
      Number(b.is_registration) - Number(a.is_registration) ||
      a.created_at.localeCompare(b.created_at)
  );
  return sorted.map((p, i) => ({ ...p, previous: i > 0 ? sorted[i - 1] : null }));
}

export type PlacementDateViolation =
  | { kind: "before_registration"; date: string }
  | { kind: "registration_after_move"; date: string };

/**
 * Pendaftaran selalu catatan paling awal: perpindahan tidak boleh bertanggal
 * sebelum pendaftaran, dan tanggal pendaftaran tidak boleh melewati
 * perpindahan mana pun. Sama dengan trigger asset_placements_guard.
 */
export function placementDateViolation(
  existing: { id: string; event_date: string; is_registration: boolean }[],
  record: { id?: string; event_date: string }
): PlacementDateViolation | null {
  const registration = existing.find((p) => p.is_registration);
  if (record.id && record.id === registration?.id) {
    const firstMove = existing
      .filter((p) => !p.is_registration)
      .map((p) => p.event_date)
      .sort()[0];
    return firstMove && record.event_date > firstMove ? { kind: "registration_after_move", date: firstMove } : null;
  }
  if (registration && record.event_date < registration.event_date)
    return { kind: "before_registration", date: registration.event_date };
  return null;
}

// ============================================================
// AUDIT LOG (posm_audit_log, trigger migrasi 043)
// ============================================================

export type AuditChange = { field: string; old: unknown; new: unknown };

// Kolom pembukuan yang selalu berubah/tidak informatif di tampilan diff.
const AUDIT_IGNORED_FIELDS = new Set(["id", "created_at", "created_by", "updated_at", "updated_by"]);

/**
 * Field yang berubah pada satu baris audit (nilai lama → baru). Insert
 * menampilkan semua field yang terisi.
 */
export function auditChanges(
  action: PosmAuditAction,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null
): AuditChange[] {
  const before = oldData ?? {};
  const after = newData ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields
    .filter((field) => !AUDIT_IGNORED_FIELDS.has(field))
    .filter((field) =>
      action === "insert"
        ? after[field] !== null && after[field] !== undefined
        : JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)
    )
    .map((field) => ({ field, old: before[field] ?? null, new: after[field] ?? null }));
}

export const POSM_AUDIT_TABLES = [
  "posm_items",
  "posm_movements",
  "marketing_assets",
  "asset_placements",
  "gimmick_items",
  "gimmick_movements",
] as const;
export type PosmAuditTable = (typeof POSM_AUDIT_TABLES)[number];

export const POSM_AUDIT_TABLE_LABELS: Record<PosmAuditTable, string> = {
  posm_items: "Item POSM",
  posm_movements: "Mutasi POSM",
  marketing_assets: "Asset",
  asset_placements: "Penempatan Asset",
  gimmick_items: "Item Gimmick",
  gimmick_movements: "Mutasi Gimmick",
};

export const POSM_AUDIT_ACTIONS: readonly PosmAuditAction[] = ["insert", "update", "soft_delete"];

export const POSM_AUDIT_ACTION_LABELS: Record<PosmAuditAction, string> = {
  insert: "Tambah",
  update: "Ubah",
  soft_delete: "Hapus",
};

export const POSM_AUDIT_PAGE_SIZE = 50;

/** Filter audit; `T` = tabel yang boleh dipilih (POSM atau modul lain, mis. event). */
export type AuditFilters<T extends string> = {
  table?: T;
  action?: PosmAuditAction;
  actor?: string;
  /** Record beserta turunannya (mutasi item / penempatan asset). */
  record?: string;
  from?: string;
  to?: string;
  page: number;
};

export type PosmAuditFilters = AuditFilters<PosmAuditTable>;

const AUDIT_FILTER_KEYS = ["table", "action", "actor", "record", "from", "to"] as const;

export function parseAuditFilters(params: Record<string, string | string[] | undefined>): PosmAuditFilters {
  return parseAuditFiltersFor(params, POSM_AUDIT_TABLES);
}

/** Seperti parseAuditFilters, dengan daftar tabel milik modul pemanggil. */
export function parseAuditFiltersFor<T extends string>(
  params: Record<string, string | string[] | undefined>,
  tables: readonly T[]
): AuditFilters<T> {
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v.trim() : undefined;
  };
  const matching = (key: string, pattern: RegExp) => {
    const v = one(key);
    return v && pattern.test(v) ? v : undefined;
  };

  const table = one("table");
  const action = one("action");
  const page = Number(one("page"));
  const filters: AuditFilters<T> = {
    table: tables.includes(table as T) ? (table as T) : undefined,
    action: POSM_AUDIT_ACTIONS.includes(action as PosmAuditAction) ? (action as PosmAuditAction) : undefined,
    actor: matching("actor", UUID),
    record: matching("record", UUID),
    from: matching("from", ISO_DATE),
    to: matching("to", ISO_DATE),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)) as AuditFilters<T>;
}

/** Query string untuk filter audit (halaman 1 dan nilai kosong dihilangkan). */
export function auditFiltersQuery(filters: Partial<AuditFilters<string>>): string {
  const params = new URLSearchParams();
  for (const key of AUDIT_FILTER_KEYS) {
    const v = filters[key];
    if (v) params.set(key, v);
  }
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

export const POSM_AUDIT_FIELD_LABELS: Record<string, string> = {
  code: "Kode",
  name: "Nama",
  brand_id: "Brand",
  category: "Kategori",
  unit: "Satuan",
  min_stock: "Stok Minimum",
  photo_path: "Foto",
  is_active: "Aktif",
  deleted_at: "Dihapus",
  item_id: "Item",
  movement_date: "Tanggal",
  type: "Tipe",
  quantity: "Qty",
  region_id: "Region",
  distributor_id: "Distributor",
  campaign_id: "SKP",
  notes: "Keterangan",
  asset_type: "Jenis",
  serial_number: "Nomor Seri / Merk",
  acquisition_date: "Tanggal Perolehan",
  acquisition_value: "Nilai Perolehan",
  asset_id: "Asset",
  event_date: "Tanggal",
  destination: "Tujuan",
  store_name: "Nama Toko",
  store_address: "Alamat Toko",
  pic_name: "PIC",
  condition: "Kondisi",
  is_registration: "Pendaftaran",
  pcs_per_carton: "Isi per Karton",
  unit_cost: "Harga Pokok",
  suggested_price: "Harga Jual Saran",
  unit_cost_snapshot: "Harga Snapshot",
  program: "Program",
  recipient_name: "PIC / Penerima",
};

// Kolom rupiah yang ditampilkan dengan format IDR.
const AUDIT_CURRENCY_FIELDS = new Set(["acquisition_value", "unit_cost", "suggested_price", "unit_cost_snapshot"]);

/** Kolom berisi id yang ditampilkan lewat nama (lookup). */
export const POSM_AUDIT_REFERENCE_FIELDS = [
  "brand_id",
  "item_id",
  "region_id",
  "distributor_id",
  "campaign_id",
  "asset_id",
] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal + jam WIB untuk kolom timestamptz audit. */
export function formatAuditTimestamp(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/** Nilai audit dalam bentuk yang mudah dibaca; id referensi lewat `names`. */
export function formatAuditValue(field: string, value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if ((POSM_AUDIT_REFERENCE_FIELDS as readonly string[]).includes(field)) {
    return names.get(String(value)) ?? String(value);
  }
  if (field === "type" && typeof value === "string" && value in POSM_MOVEMENT_LABELS) return POSM_MOVEMENT_LABELS[value as PosmMovementType];
  // Nilai tujuan asset dan gimmick tidak beririsan, jadi cukup dicek berurutan.
  if (field === "destination" && typeof value === "string") {
    if (value in ASSET_DESTINATION_LABELS) return ASSET_DESTINATION_LABELS[value as AssetDestination];
    if (value in GIMMICK_DESTINATION_LABELS) return GIMMICK_DESTINATION_LABELS[value as GimmickDestination];
  }
  if (AUDIT_CURRENCY_FIELDS.has(field)) return formatIDR(Number(value));
  if (typeof value === "number") return value.toLocaleString("id-ID");
  if (typeof value === "string" && DATE_ONLY.test(value)) return formatDate(value);
  if (typeof value === "string" && TIMESTAMP.test(value)) return formatAuditTimestamp(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Label record dari snapshot audit (tetap bisa dibaca setelah record dihapus). */
export function auditRecordLabel(table: string, data: Record<string, unknown>, names: Map<string, string>): string {
  const ref = (id: unknown) => (typeof id === "string" ? names.get(id) ?? id : "—");
  switch (table) {
    case "posm_items":
    case "marketing_assets":
    case "gimmick_items":
      return `${data.code ?? "—"} — ${data.name ?? "—"}`;
    case "posm_movements":
    case "gimmick_movements": {
      const type = POSM_MOVEMENT_LABELS[data.type as PosmMovementType] ?? String(data.type);
      return `${type} ${formatAuditValue("quantity", data.quantity, names)} • ${ref(data.item_id)}`;
    }
    case "asset_placements": {
      const destination = ASSET_DESTINATION_LABELS[data.destination as AssetDestination] ?? String(data.destination);
      const place = data.destination === "placed" && data.store_name ? `${destination}: ${data.store_name}` : destination;
      return `${place} • ${ref(data.asset_id)}`;
    }
    default:
      return String(data.id ?? "—");
  }
}

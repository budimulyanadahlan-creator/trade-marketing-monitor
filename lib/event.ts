/**
 * Logika murni Monitoring Event & Activity (plans/prd-monitoring-event.md).
 */

import { z } from "zod";
import { getFiscalPeriod, type FiscalPeriod } from "@/lib/monitoring-budget";
import { formatAuditValue, parseAuditFiltersFor, type AuditFilters } from "@/lib/posm";
import { formatIDR } from "@/lib/utils";
import type { EventStatus, EventType } from "@/types/database";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  rencana: "Rencana",
  terlaksana: "Terlaksana",
  batal: "Batal",
};

// Daftar tetap — harus sama dengan check constraint events (migrasi 054).
export const EVENT_TYPES: readonly EventType[] = [
  "Senam/Olahraga",
  "Perayaan",
  "Bazaar",
  "Lomba/Run",
  "Aktivitas Outlet MT",
  "School to School",
  "Launching Produk Baru",
  "Local Region Event",
  "Lainnya",
];

// ============================================================
// PERIODE
// ============================================================

/**
 * Kuartal fiskal event, diturunkan dari tanggal mulai (`YYYY-MM-DD`). Event
 * yang melewati batas kuartal tetap dihitung di kuartal tanggal mulainya.
 * Harus sama dengan kolom generated fiscal_year/quarter di tabel events
 * (migrasi 054).
 */
export function eventFiscalPeriod(startDate: string): FiscalPeriod {
  const [year, month, day] = startDate.split("-").map(Number);
  // Dibentuk dari komponen lokal agar tidak bergeser zona waktu.
  return getFiscalPeriod(new Date(year, month - 1, day));
}

// ============================================================
// VALIDASI FORM RENCANA
// ============================================================

const requiredText = (message: string) => z.string({ error: message }).trim().min(1, message);

const isoDate = (message: string) =>
  z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message);

/** Angka rupiah/qty wajib ≥ 0; string kosong dianggap belum diisi. */
const requiredAmount = (label: string, { integer = false } = {}) => {
  const number = z.coerce.number<string>({ error: `${label} harus berupa angka` }).min(0, `${label} tidak boleh negatif`);
  return z
    .string({ error: `${label} harus diisi` })
    .trim()
    .min(1, `${label} harus diisi`)
    .pipe(integer ? number.int(`${label} harus bilangan bulat`) : number);
};

/** Id referensi opsional; string kosong/tidak ada = null. */
const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().uuid(message).nullable());

/** Daftar id (checkbox/hidden input berulang), duplikat dibuang. */
const idList = (message: string) =>
  z
    .array(z.string().uuid(message))
    .optional()
    .transform((ids) => [...new Set(ids ?? [])]);

const eventPlanSchema = z
  .object({
    distributor_id: optionalId("Distributor tidak valid"),
    vendor_id: optionalId("Vendor tidak valid"),
    notes: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null),
    brand_ids: idList("Brand tidak valid"),
    campaign_ids: idList("SKP tidak valid"),
    name: requiredText("Nama event harus diisi"),
    event_type: z.enum(EVENT_TYPES as [EventType, ...EventType[]], { error: "Pilih jenis event" }),
    start_date: isoDate("Tanggal mulai harus diisi"),
    end_date: isoDate("Tanggal selesai harus diisi"),
    region_id: z.string({ error: "Pilih region" }).uuid("Pilih region"),
    location: requiredText("Lokasi harus diisi"),
    pic_name: requiredText("PIC harus diisi"),
    target_participants: requiredAmount("Target peserta", { integer: true }),
    target_sales: requiredAmount("Target sales"),
    planned_budget: requiredAmount("Rencana budget event"),
    planned_sample_budget: requiredAmount("Rencana budget sample"),
  })
  // Aturan yang sama ditegakkan check constraint events_dates (migrasi 054).
  .refine((v) => v.end_date >= v.start_date, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
  });

type EventLinkField = "brand_ids" | "campaign_ids";
type EventCostField = "planned_budget" | "planned_sample_budget" | "vendor_id";

export type EventPlanInput = Partial<
  Record<Exclude<keyof z.input<typeof eventPlanSchema>, EventLinkField>, string> &
    Record<EventLinkField, string[]>
>;

type EventPlanOutput = z.output<typeof eventPlanSchema>;

export type EventPlan = {
  event: Omit<EventPlanOutput, EventCostField | EventLinkField>;
  costs: Pick<EventPlanOutput, EventCostField>;
  links: Pick<EventPlanOutput, EventLinkField>;
};

/**
 * Validasi form event: field wajib Rencana plus tautan opsional (brand,
 * distributor, vendor, SKP, keterangan). Mengembalikan kolom `events`,
 * `event_costs`, dan tautan yang siap disimpan, atau pesan error pertama.
 */
export function parseEventPlan(values: EventPlanInput): { error: string } | { data: EventPlan } {
  const parsed = eventPlanSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  const { planned_budget, planned_sample_budget, vendor_id, brand_ids, campaign_ids, ...event } = parsed.data;
  return {
    data: {
      event,
      costs: { planned_budget, planned_sample_budget, vendor_id },
      links: { brand_ids, campaign_ids },
    },
  };
}

// ============================================================
// FILTER TABEL
// ============================================================

export type EventListFilters = {
  type?: EventType;
  region?: string;
  brand?: string;
  status?: EventStatus;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filter tabel dari query string; nilai yang tidak dikenal diabaikan. */
export function parseEventListFilters(params: Record<string, string | string[] | undefined>): EventListFilters {
  const one = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: EventListFilters = {};

  const type = one("type");
  if (type && (EVENT_TYPES as readonly string[]).includes(type)) filters.type = type as EventType;
  const region = one("region");
  if (region && UUID_RE.test(region)) filters.region = region;
  const brand = one("brand");
  if (brand && UUID_RE.test(brand)) filters.brand = brand;
  const status = one("status");
  if (status && Object.hasOwn(EVENT_STATUS_LABELS, status)) filters.status = status as EventStatus;

  return filters;
}

// ============================================================
// SARAN DARI SKP
// ============================================================

/** Field event yang bisa disarankan dari SKP; "" = belum diisi. */
export type EventSuggestibleFields = { region_id: string; distributor_id: string; brand_ids: string[] };

export type CampaignSuggestionSource = {
  region_id: string | null;
  distributor_id: string | null;
  brand_id: string | null;
};

/**
 * Saran region/distributor/brand dari SKP yang dipilih. Field yang masih
 * kosong langsung diisi (`fill`); field yang sudah berisi nilai lain hanya
 * diubah setelah konfirmasi user (`confirm`). Brand ditambahkan ke daftar,
 * bukan menggantikan. Budget sengaja tidak disarankan.
 */
export function suggestFromCampaign(
  current: EventSuggestibleFields,
  campaign: CampaignSuggestionSource
): { fill: Partial<EventSuggestibleFields>; confirm: Partial<EventSuggestibleFields> } {
  const fill: Partial<EventSuggestibleFields> = {};
  const confirm: Partial<EventSuggestibleFields> = {};

  for (const field of ["region_id", "distributor_id"] as const) {
    const suggested = campaign[field];
    if (!suggested || current[field] === suggested) continue;
    if (current[field]) confirm[field] = suggested;
    else fill[field] = suggested;
  }

  if (campaign.brand_id && !current.brand_ids.includes(campaign.brand_id)) {
    const next = [...current.brand_ids, campaign.brand_id];
    if (current.brand_ids.length) confirm.brand_ids = next;
    else fill.brand_ids = next;
  }

  return { fill, confirm };
}

// ============================================================
// AUDIT LOG (posm_audit_log, trigger migrasi 055)
// ============================================================

// Baris event_costs dan tautan (migrasi 056) dicatat dengan record_id =
// event_id, sehingga riwayat satu event mencakup biaya dan tautannya.
export const EVENT_AUDIT_TABLES = ["events", "event_costs", "event_brands", "event_campaigns"] as const;
export type EventAuditTable = (typeof EVENT_AUDIT_TABLES)[number];

export const EVENT_AUDIT_TABLE_LABELS: Record<EventAuditTable, string> = {
  events: "Event",
  event_costs: "Biaya Event",
  event_brands: "Brand Event",
  event_campaigns: "SKP Event",
};

export type EventAuditFilters = AuditFilters<EventAuditTable>;

export function parseEventAuditFilters(params: Record<string, string | string[] | undefined>): EventAuditFilters {
  return parseAuditFiltersFor(params, EVENT_AUDIT_TABLES);
}

export const EVENT_AUDIT_FIELD_LABELS: Record<string, string> = {
  name: "Nama Event",
  event_type: "Jenis",
  start_date: "Tanggal Mulai",
  end_date: "Tanggal Selesai",
  fiscal_year: "Tahun Fiskal",
  quarter: "Kuartal",
  region_id: "Region",
  location: "Lokasi",
  distributor_id: "Distributor",
  pic_name: "PIC",
  target_participants: "Target Peserta",
  target_sales: "Target Sales",
  status: "Status",
  actual_participants: "Peserta Aktual",
  actual_sales: "Hasil Sales",
  cancel_reason: "Alasan Batal",
  notes: "Keterangan",
  deleted_at: "Dihapus",
  event_id: "Event",
  planned_budget: "Rencana Budget Event",
  actual_budget: "Realisasi Budget Event",
  planned_sample_budget: "Rencana Budget Sample",
  vendor_id: "Vendor",
  brand_id: "Brand",
  campaign_id: "SKP",
  skp_number: "Nomor SKP",
  campaign_name: "Judul SKP",
};

const EVENT_AUDIT_CURRENCY_FIELDS = new Set([
  "target_sales",
  "actual_sales",
  "planned_budget",
  "actual_budget",
  "planned_sample_budget",
]);

/** Nilai audit event yang mudah dibaca; id referensi (region, vendor, event) lewat `names`. */
export function formatEventAuditValue(field: string, value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "—";
  if (EVENT_AUDIT_CURRENCY_FIELDS.has(field)) return formatIDR(Number(value));
  if (field === "status" && typeof value === "string" && value in EVENT_STATUS_LABELS) {
    return EVENT_STATUS_LABELS[value as EventStatus];
  }
  if ((field === "vendor_id" || field === "event_id") && typeof value === "string") {
    return names.get(value) ?? value;
  }
  return formatAuditValue(field, value, names);
}

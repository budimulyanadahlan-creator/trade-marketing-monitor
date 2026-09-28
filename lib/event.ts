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
// STATUS & REALISASI
// ============================================================

/** Angka rupiah opsional ≥ 0; string kosong/tidak ada = null. */
const optionalAmount = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(
      z.coerce
        .number<string>({ error: `${label} harus berupa angka` })
        .min(0, `${label} tidak boleh negatif`)
        .nullable()
    );

// Aturan yang sama ditegakkan di database (migrasi 057). Status Rencana
// tidak mengubah field realisasi: nilainya tetap tersimpan untuk koreksi,
// tetapi tidak dihitung sebagai aktual.
const eventStatusSchema = z.discriminatedUnion(
  "status",
  [
    z.object({ status: z.literal("rencana") }),
    z.object({
      status: z.literal("terlaksana"),
      actual_participants: requiredAmount("Peserta aktual", { integer: true }),
      actual_sales: requiredAmount("Hasil sales"),
      actual_budget: requiredAmount("Realisasi budget event"),
    }),
    z.object({
      status: z.literal("batal"),
      cancel_reason: requiredText("Alasan batal harus diisi"),
      // Boleh diisi untuk biaya hangus (misalnya DP vendor).
      actual_budget: optionalAmount("Realisasi budget event"),
    }),
  ],
  { error: "Pilih status" }
);

export type EventStatusUpdateInput = Partial<
  Record<"status" | "actual_participants" | "actual_sales" | "actual_budget" | "cancel_reason", string>
>;

/** Nilai yang dikirim ke set_event_status; null = tidak diubah/dikosongkan sesuai status. */
export type EventStatusUpdate = {
  status: EventStatus;
  actual_participants: number | null;
  actual_sales: number | null;
  actual_budget: number | null;
  cancel_reason: string | null;
};

/**
 * Validasi perubahan status. Terlaksana wajib peserta aktual, hasil sales,
 * dan realisasi budget, dan hanya jika tanggal mulai ≤ hari ini (`YYYY-MM-DD`).
 * Batal wajib alasan; realisasi budget opsional.
 */
export function parseEventStatusUpdate(
  values: EventStatusUpdateInput,
  { startDate, today }: { startDate: string; today: string }
): { error: string } | { data: EventStatusUpdate } {
  const parsed = eventStatusSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  const v = parsed.data;

  if (v.status === "terlaksana" && startDate > today) {
    return { error: EVENT_NOT_STARTED };
  }

  return {
    data: {
      status: v.status,
      actual_participants: v.status === "terlaksana" ? v.actual_participants : null,
      actual_sales: v.status === "terlaksana" ? v.actual_sales : null,
      actual_budget: v.status === "rencana" ? null : v.actual_budget,
      cancel_reason: v.status === "batal" ? v.cancel_reason : null,
    },
  };
}

export const EVENT_NOT_STARTED = "Event belum dimulai, belum bisa ditandai Terlaksana";

/** Tanggal hari ini (`YYYY-MM-DD`) di zona Asia/Jakarta, sama dengan database. */
export function todayInJakarta(now: Date = new Date()): string {
  // en-CA memformat tanggal sebagai YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Badge "Perlu update": masih Rencana padahal tanggal selesai sudah lewat. */
export function eventNeedsUpdate(event: { status: EventStatus; end_date: string }, today: string): boolean {
  return event.status === "rencana" && event.end_date < today;
}

// ============================================================
// RINCIAN SAMPLING
// ============================================================

// Aturan yang sama ditegakkan check constraint event_samplings dan
// event_sampling_costs (migrasi 058).
const eventSamplingSchema = z.object({
  product_name: requiredText("Nama produk harus diisi"),
  quantity: z
    .string({ error: "Qty harus diisi" })
    .trim()
    .min(1, "Qty harus diisi")
    .pipe(z.coerce.number<string>({ error: "Qty harus berupa angka" }).gt(0, "Qty harus lebih dari 0")),
  unit: requiredText("Satuan harus diisi"),
  value: requiredAmount("Nilai sampling"),
});

export type EventSamplingInput = Partial<Record<keyof z.input<typeof eventSamplingSchema>, string>>;
export type EventSampling = z.output<typeof eventSamplingSchema>;

/** Validasi satu baris sampling: nama produk (teks bebas), qty > 0, satuan, nilai Rp ≥ 0. */
export function parseEventSampling(values: EventSamplingInput): { error: string } | { data: EventSampling } {
  const parsed = eventSamplingSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  return { data: parsed.data };
}

export type EventSamplingSummary = {
  total: number;
  planned: number;
  /** Rencana − terpakai; negatif = melebihi rencana. */
  remaining: number;
  /** Terpakai sebagai persen rencana; null jika rencana 0. */
  percentOfPlan: number | null;
};

/** Total nilai sampling dibandingkan rencana budget sample. */
export function summarizeEventSampling(rows: { value: number }[], plannedSampleBudget: number): EventSamplingSummary {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return {
    total,
    planned: plannedSampleBudget,
    remaining: plannedSampleBudget - total,
    percentOfPlan: plannedSampleBudget > 0 ? (total / plannedSampleBudget) * 100 : null,
  };
}

// ============================================================
// KPI KUARTAL
// ============================================================

export type EventKpiSource = {
  status: EventStatus;
  target_participants: number;
  target_sales: number;
  actual_participants: number | null;
  actual_sales: number | null;
  planned_budget: number;
  actual_budget: number | null;
  planned_sample_budget: number;
  /** Total nilai Rp baris sampling aktif event ini. */
  sampling_value: number;
};

export type EventKpiPair = { target: number; actual: number };

export type EventKpis = {
  counts: Record<EventStatus, number> & { total: number };
  participants: EventKpiPair;
  sales: EventKpiPair;
  /** Budget event rencana vs realisasi (terpakai). */
  budget: EventKpiPair;
  /** Budget sample rencana vs nilai sampling terpakai. */
  sampleBudget: EventKpiPair;
};

/**
 * Agregasi KPI event kuartal/filter aktif (event terhapus tidak ikut dikirim).
 * Target dan rencana budget dari Rencana + Terlaksana (Batal dikeluarkan).
 * Aktual peserta/sales hanya dari Terlaksana, sehingga realisasi lama pada
 * event yang dikoreksi ke Rencana tidak dihitung. Budget dan sampling
 * terpakai dari Terlaksana + Batal, karena event Batal bisa punya biaya hangus.
 */
export function summarizeEventKpis(events: EventKpiSource[]): EventKpis {
  const counts = { rencana: 0, terlaksana: 0, batal: 0, total: events.length };
  const participants = { target: 0, actual: 0 };
  const sales = { target: 0, actual: 0 };
  const budget = { target: 0, actual: 0 };
  const sampleBudget = { target: 0, actual: 0 };

  for (const e of events) {
    counts[e.status] += 1;

    if (e.status !== "rencana") {
      budget.actual += e.actual_budget ?? 0;
      sampleBudget.actual += e.sampling_value;
    }
    if (e.status === "batal") continue;

    participants.target += e.target_participants;
    sales.target += e.target_sales;
    budget.target += e.planned_budget;
    sampleBudget.target += e.planned_sample_budget;
    if (e.status === "terlaksana") {
      participants.actual += e.actual_participants ?? 0;
      sales.actual += e.actual_sales ?? 0;
    }
  }

  return { counts, participants, sales, budget, sampleBudget };
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

// Baris event_costs, tautan (migrasi 056), dan sampling (migrasi 058)
// dicatat dengan record_id = event_id, sehingga riwayat satu event mencakup
// biaya, tautan, dan rincian samplingnya.
export const EVENT_AUDIT_TABLES = [
  "events",
  "event_costs",
  "event_brands",
  "event_campaigns",
  "event_samplings",
  "event_sampling_costs",
] as const;
export type EventAuditTable = (typeof EVENT_AUDIT_TABLES)[number];

export const EVENT_AUDIT_TABLE_LABELS: Record<EventAuditTable, string> = {
  events: "Event",
  event_costs: "Biaya Event",
  event_brands: "Brand Event",
  event_campaigns: "SKP Event",
  event_samplings: "Sampling Event",
  event_sampling_costs: "Nilai Sampling",
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
  product_name: "Produk",
  quantity: "Qty",
  unit: "Satuan",
  value: "Nilai Sampling",
};

const EVENT_AUDIT_CURRENCY_FIELDS = new Set([
  "target_sales",
  "actual_sales",
  "planned_budget",
  "actual_budget",
  "planned_sample_budget",
  "value",
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

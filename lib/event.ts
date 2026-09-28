/**
 * Logika murni Monitoring Event & Activity (plans/prd-monitoring-event.md).
 */

import { z } from "zod";
import { getFiscalPeriod, type FiscalPeriod } from "@/lib/monitoring-budget";
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

const eventPlanSchema = z
  .object({
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

export type EventPlanInput = Partial<Record<keyof z.input<typeof eventPlanSchema>, string>>;

export type EventPlan = {
  event: Omit<z.output<typeof eventPlanSchema>, "planned_budget" | "planned_sample_budget">;
  costs: { planned_budget: number; planned_sample_budget: number };
};

/**
 * Validasi field wajib event berstatus Rencana. Mengembalikan kolom `events`
 * dan `event_costs` yang siap disimpan, atau pesan error pertama.
 */
export function parseEventPlan(values: EventPlanInput): { error: string } | { data: EventPlan } {
  const parsed = eventPlanSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  const { planned_budget, planned_sample_budget, ...event } = parsed.data;
  return { data: { event, costs: { planned_budget, planned_sample_budget } } };
}

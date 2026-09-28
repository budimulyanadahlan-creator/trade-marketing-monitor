"use server";

import { revalidatePath } from "next/cache";
import { requirePosmWriter } from "@/lib/posm-writer";
import {
  EVENT_NOT_STARTED,
  parseEventPlan,
  parseEventSampling,
  parseEventStatusUpdate,
  todayInJakarta,
  type EventPlan,
  type EventPlanInput,
  type EventSamplingInput,
  type EventStatusUpdateInput,
} from "@/lib/event";

const PAGE_PATH = "/monitoring-event";
const FORBIDDEN = "Anda tidak memiliki akses.";
const NOT_FOUND = "Event tidak ditemukan atau sudah dihapus.";
const SAMPLING_NOT_FOUND = "Baris sampling tidak ditemukan atau sudah dihapus.";

const PLAN_FIELDS = [
  "name",
  "event_type",
  "start_date",
  "end_date",
  "region_id",
  "location",
  "pic_name",
  "target_participants",
  "target_sales",
  "planned_budget",
  "planned_sample_budget",
  "distributor_id",
  "vendor_id",
  "notes",
] as const satisfies readonly (keyof EventPlanInput)[];

// Brand & SKP dikirim sebagai input berulang (satu per id).
const LINK_FIELDS = ["brand_ids", "campaign_ids"] as const satisfies readonly (keyof EventPlanInput)[];

function planValues(formData: FormData): EventPlanInput {
  const values: EventPlanInput = {};
  for (const field of PLAN_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") values[field] = v;
  }
  for (const field of LINK_FIELDS) {
    values[field] = formData.getAll(field).filter((v): v is string => typeof v === "string" && v !== "");
  }
  return values;
}

/** Parameter create_event/update_event dari hasil parseEventPlan. */
function planRpcArgs({ event, costs, links }: EventPlan) {
  return {
    p_name: event.name,
    p_event_type: event.event_type,
    p_start_date: event.start_date,
    p_end_date: event.end_date,
    p_region_id: event.region_id,
    p_location: event.location,
    p_pic_name: event.pic_name,
    p_target_participants: event.target_participants,
    p_target_sales: event.target_sales,
    p_planned_budget: costs.planned_budget,
    p_planned_sample_budget: costs.planned_sample_budget,
    p_distributor_id: event.distributor_id,
    p_vendor_id: costs.vendor_id,
    p_notes: event.notes,
    p_brand_ids: links.brand_ids,
    p_campaign_ids: links.campaign_ids,
  };
}

// Pesan ramah untuk constraint migrasi 054/057 yang juga dicek di form, dan
// penolakan update_event (migrasi 055).
function eventErrorMessage(error: { message: string }): string {
  if (error.message.includes("events_dates")) return "Tanggal selesai tidak boleh sebelum tanggal mulai";
  if (error.message.includes("EVENT_BELUM_DIMULAI")) return EVENT_NOT_STARTED;
  if (error.message.includes("EVENT_TANPA_REALISASI") || error.message.includes("events_terlaksana_realization")) {
    return "Event Terlaksana wajib punya peserta aktual, hasil sales, dan realisasi budget";
  }
  if (error.message.includes("events_batal_reason")) return "Alasan batal harus diisi";
  if (error.message.includes("EVENT_TIDAK_DITEMUKAN")) return NOT_FOUND;
  if (error.message.includes("SKP_TIDAK_DITEMUKAN")) return "SKP yang dipilih tidak ditemukan.";
  // Rincian sampling (migrasi 058).
  if (error.message.includes("event_samplings_quantity_check")) return "Qty harus lebih dari 0";
  if (error.message.includes("event_sampling_costs_value_check")) return "Nilai sampling tidak boleh negatif";
  if (error.message.includes("SAMPLING_TIDAK_DITEMUKAN")) return SAMPLING_NOT_FOUND;
  return error.message;
}

export type CreateEventState = { error?: string; success?: boolean; id?: string };

// Event baru selalu berstatus Rencana. Baris events dan event_costs dibuat
// dalam satu transaksi lewat fungsi create_event (migrasi 054).
export async function createEventAction(
  _prevState: CreateEventState,
  formData: FormData
): Promise<CreateEventState> {
  try {
    const { supabase } = await requirePosmWriter();

    const parsed = parseEventPlan(planValues(formData));
    if ("error" in parsed) return { error: parsed.error };

    const { data: id, error } = await supabase.rpc("create_event", planRpcArgs(parsed.data));
    if (error) return { error: eventErrorMessage(error) };

    revalidatePath(PAGE_PATH);
    return { success: true, id: id ?? undefined };
  } catch {
    return { error: FORBIDDEN };
  }
}

export type UpdateEventState = CreateEventState;

// Pemegang hak tulis boleh mengedit event siapa pun. Baris events dan
// event_costs diubah dalam satu transaksi lewat fungsi update_event
// (migrasi 055), yang menolak event terhapus atau yang tidak lolos RLS.
export async function updateEventAction(
  _prevState: UpdateEventState,
  formData: FormData
): Promise<UpdateEventState> {
  try {
    const { supabase } = await requirePosmWriter();

    const id = formData.get("id");
    if (typeof id !== "string" || !id) return { error: NOT_FOUND };

    const parsed = parseEventPlan(planValues(formData));
    if ("error" in parsed) return { error: parsed.error };

    const { error } = await supabase.rpc("update_event", { p_id: id, ...planRpcArgs(parsed.data) });
    if (error) return { error: eventErrorMessage(error) };

    revalidatePath(PAGE_PATH);
    revalidatePath(`${PAGE_PATH}/${id}`);
    return { success: true, id };
  } catch {
    return { error: FORBIDDEN };
  }
}

const STATUS_FIELDS = [
  "status",
  "actual_participants",
  "actual_sales",
  "actual_budget",
  "cancel_reason",
] as const satisfies readonly (keyof EventStatusUpdateInput)[];

// Ubah status + realisasi lewat set_event_status (migrasi 057), yang juga
// menegakkan aturan per status. Tanggal mulai dibaca dari database agar
// aturan "Terlaksana hanya setelah dimulai" tidak bergantung pada form.
export async function updateEventStatusAction(
  _prevState: UpdateEventState,
  formData: FormData
): Promise<UpdateEventState> {
  try {
    const { supabase } = await requirePosmWriter();

    const id = formData.get("id");
    if (typeof id !== "string" || !id) return { error: NOT_FOUND };

    const { data: event } = await supabase
      .from("events")
      .select("start_date")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!event) return { error: NOT_FOUND };

    const values: EventStatusUpdateInput = {};
    for (const field of STATUS_FIELDS) {
      const v = formData.get(field);
      if (typeof v === "string") values[field] = v;
    }
    const parsed = parseEventStatusUpdate(values, { startDate: event.start_date, today: todayInJakarta() });
    if ("error" in parsed) return { error: parsed.error };

    const { status, actual_participants, actual_sales, actual_budget, cancel_reason } = parsed.data;
    const { error } = await supabase.rpc("set_event_status", {
      p_id: id,
      p_status: status,
      p_actual_participants: actual_participants,
      p_actual_sales: actual_sales,
      p_actual_budget: actual_budget,
      p_cancel_reason: cancel_reason,
    });
    if (error) return { error: eventErrorMessage(error) };

    revalidatePath(PAGE_PATH);
    revalidatePath(`${PAGE_PATH}/${id}`);
    return { success: true, id };
  } catch {
    return { error: FORBIDDEN };
  }
}

// Hapus = soft delete. Semua pemegang hak tulis boleh menghapus event siapa
// pun; trigger audit mencatatnya sebagai soft_delete. Update yang ditolak RLS
// tidak mengembalikan error, jadi baris yang ter-update dicek lewat select.
export async function deleteEventAction(id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { data, error } = await supabase
      .from("events")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: NOT_FOUND };

    revalidatePath(PAGE_PATH);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

const SAMPLING_FIELDS = [
  "product_name",
  "quantity",
  "unit",
  "value",
] as const satisfies readonly (keyof EventSamplingInput)[];

export type SaveEventSamplingState = { error?: string; success?: boolean };

// Tambah (tanpa id) atau ubah baris sampling. Baris dan nilai Rp-nya
// disimpan dalam satu transaksi lewat save_event_sampling (migrasi 058).
export async function saveEventSamplingAction(
  _prevState: SaveEventSamplingState,
  formData: FormData
): Promise<SaveEventSamplingState> {
  try {
    const { supabase } = await requirePosmWriter();

    const eventId = formData.get("event_id");
    if (typeof eventId !== "string" || !eventId) return { error: NOT_FOUND };
    const id = formData.get("id");

    const values: EventSamplingInput = {};
    for (const field of SAMPLING_FIELDS) {
      const v = formData.get(field);
      if (typeof v === "string") values[field] = v;
    }
    const parsed = parseEventSampling(values);
    if ("error" in parsed) return { error: parsed.error };

    const { product_name, quantity, unit, value } = parsed.data;
    const { error } = await supabase.rpc("save_event_sampling", {
      p_event_id: eventId,
      p_id: typeof id === "string" && id ? id : null,
      p_product_name: product_name,
      p_quantity: quantity,
      p_unit: unit,
      p_value: value,
    });
    if (error) return { error: eventErrorMessage(error) };

    revalidatePath(`${PAGE_PATH}/${eventId}`);
    return { success: true };
  } catch {
    return { error: FORBIDDEN };
  }
}

// Hapus baris sampling = soft delete; nilai Rp-nya dibiarkan untuk audit.
// Update yang ditolak RLS tidak mengembalikan error, jadi baris yang
// ter-update dicek lewat select.
export async function deleteEventSamplingAction(eventId: string, id: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requirePosmWriter();

    const { data, error } = await supabase
      .from("event_samplings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("event_id", eventId)
      .is("deleted_at", null)
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: SAMPLING_NOT_FOUND };

    revalidatePath(`${PAGE_PATH}/${eventId}`);
    return {};
  } catch {
    return { error: FORBIDDEN };
  }
}

export type EventCampaignOption = {
  id: string;
  skp_number: string | null;
  name: string;
  region_id: string | null;
  distributor_id: string | null;
  brand_id: string | null;
};

// Lewat fungsi database search_event_campaigns (migrasi 056) karena RLS
// campaigns membatasi user Marketing hanya melihat SKP miliknya sendiri.
// Region/distributor/brand SKP dipakai form untuk saran isian.
export async function searchEventCampaignsAction(
  query: string
): Promise<{ campaigns: EventCampaignOption[]; error?: string }> {
  const q = query.trim();
  try {
    const { supabase } = await requirePosmWriter();
    if (q.length < 2) return { campaigns: [] };

    const { data, error } = await supabase.rpc("search_event_campaigns", { p_query: q });
    if (error) return { campaigns: [], error: error.message };
    return { campaigns: data ?? [] };
  } catch {
    return { campaigns: [], error: FORBIDDEN };
  }
}

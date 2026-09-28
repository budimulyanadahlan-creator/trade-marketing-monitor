"use server";

import { revalidatePath } from "next/cache";
import { requirePosmWriter } from "@/lib/posm-writer";
import { parseEventPlan, type EventPlan, type EventPlanInput } from "@/lib/event";

const PAGE_PATH = "/monitoring-event";
const FORBIDDEN = "Anda tidak memiliki akses.";
const NOT_FOUND = "Event tidak ditemukan atau sudah dihapus.";

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

// Pesan ramah untuk constraint migrasi 054 yang juga dicek di form, dan
// penolakan update_event (migrasi 055).
function eventErrorMessage(error: { message: string }): string {
  if (error.message.includes("events_dates")) return "Tanggal selesai tidak boleh sebelum tanggal mulai";
  if (error.message.includes("EVENT_TIDAK_DITEMUKAN")) return NOT_FOUND;
  if (error.message.includes("SKP_TIDAK_DITEMUKAN")) return "SKP yang dipilih tidak ditemukan.";
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

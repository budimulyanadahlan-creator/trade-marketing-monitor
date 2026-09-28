"use server";

import { revalidatePath } from "next/cache";
import { requirePosmWriter } from "@/lib/posm-writer";
import { parseEventPlan, type EventPlanInput } from "@/lib/event";

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
] as const satisfies readonly (keyof EventPlanInput)[];

function planValues(formData: FormData): EventPlanInput {
  const values: EventPlanInput = {};
  for (const field of PLAN_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") values[field] = v;
  }
  return values;
}

// Pesan ramah untuk constraint migrasi 054 yang juga dicek di form, dan
// penolakan update_event (migrasi 055).
function eventErrorMessage(error: { message: string }): string {
  if (error.message.includes("events_dates")) return "Tanggal selesai tidak boleh sebelum tanggal mulai";
  if (error.message.includes("EVENT_TIDAK_DITEMUKAN")) return NOT_FOUND;
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

    const { event, costs } = parsed.data;
    const { data: id, error } = await supabase.rpc("create_event", {
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
    });
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

    const { event, costs } = parsed.data;
    const { error } = await supabase.rpc("update_event", {
      p_id: id,
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

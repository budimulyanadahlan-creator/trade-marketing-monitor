import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createEventAction,
  deleteEventAction,
  deleteEventSamplingAction,
  saveEventSamplingAction,
  searchEventCampaignsAction,
  updateEventAction,
  updateEventStatusAction,
} from "./event";
import { createClient } from "@/lib/supabase/server";

const NEW_ID = "77777777-7777-4777-8777-777777777777";
const EVENT_ID = "88888888-8888-4888-8888-888888888888";
const REGION_ID = "11111111-1111-4111-8111-111111111111";

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  rpcError = null,
  deletedRows = [{ id: EVENT_ID }],
  existingEvent = { start_date: "2026-09-01" },
}: {
  role?: string;
  department?: string | null;
  rpcError?: { message: string; code?: string } | null;
  deletedRows?: { id: string }[];
  existingEvent?: { start_date: string } | null;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcError ? null : NEW_ID, error: rpcError });
  const updateSelect = vi.fn().mockResolvedValue({ data: deletedRows, error: null });
  const updateIs = vi.fn().mockReturnValue({ select: updateSelect });
  const updateEq = vi.fn();
  updateEq.mockReturnValue({ eq: updateEq, is: updateIs });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    rpc,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role, is_active: true, department: department ? { name: department } : null },
          }),
        };
      if (table === "events")
        return {
          update,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingEvent, error: null }),
        };
      if (table === "event_samplings") return { update };
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { rpc, update, updateEq, updateIs, from: client.from };
}

function formDataOf(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
    else fd.set(k, v);
  }
  return fd;
}

const noLinks = {
  p_distributor_id: null,
  p_vendor_id: null,
  p_notes: null,
  p_brand_ids: [],
  p_campaign_ids: [],
};

const validEvent = {
  name: "Bazaar Ramadhan",
  event_type: "Bazaar",
  start_date: "2026-09-28",
  end_date: "2026-10-03",
  region_id: REGION_ID,
  location: "Mall Taman Anggrek",
  pic_name: "Sari",
  target_participants: "1000",
  target_sales: "50000000",
  planned_budget: "20000000",
  planned_sample_budget: "5000000",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createEventAction", () => {
  it("creates the event and its planned costs in one RPC for a Trade Marketing user", async () => {
    const { rpc } = setupMocks();

    const result = await createEventAction({}, formDataOf(validEvent));

    expect(result).toEqual({ success: true, id: NEW_ID });
    expect(rpc).toHaveBeenCalledWith("create_event", {
      p_name: "Bazaar Ramadhan",
      p_event_type: "Bazaar",
      p_start_date: "2026-09-28",
      p_end_date: "2026-10-03",
      p_region_id: REGION_ID,
      p_location: "Mall Taman Anggrek",
      p_pic_name: "Sari",
      p_target_participants: 1000,
      p_target_sales: 50000000,
      p_planned_budget: 20000000,
      p_planned_sample_budget: 5000000,
      ...noLinks,
    });
  });

  it("sends the optional distributor, vendor, notes, brands, and SKPs", async () => {
    const { rpc } = setupMocks();
    const BRAND_A = "22222222-2222-4222-8222-222222222222";
    const BRAND_B = "33333333-3333-4333-8333-333333333333";
    const DISTRIBUTOR = "44444444-4444-4444-8444-444444444444";
    const VENDOR = "55555555-5555-4555-8555-555555555555";
    const SKP_A = "66666666-6666-4666-8666-666666666666";
    const SKP_B = "99999999-9999-4999-8999-999999999999";

    await createEventAction(
      {},
      formDataOf({
        ...validEvent,
        distributor_id: DISTRIBUTOR,
        vendor_id: VENDOR,
        notes: "Didanai dua SKP",
        brand_ids: [BRAND_A, BRAND_B],
        campaign_ids: [SKP_A, SKP_B],
      })
    );

    expect(rpc).toHaveBeenCalledWith(
      "create_event",
      expect.objectContaining({
        p_distributor_id: DISTRIBUTOR,
        p_vendor_id: VENDOR,
        p_notes: "Didanai dua SKP",
        p_brand_ids: [BRAND_A, BRAND_B],
        p_campaign_ids: [SKP_A, SKP_B],
      })
    );
  });

  it("lets an admin outside Marketing/TM create events", async () => {
    const { rpc } = setupMocks({ role: "admin", department: "Finance" });
    expect(await createEventAction({}, formDataOf(validEvent))).toEqual({ success: true, id: NEW_ID });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each([
    ["a Sales user", { role: "user", department: "Sales" }],
    ["a manager without department", { role: "manager", department: null }],
    ["a distributor", { role: "distributor", department: "Marketing" }],
  ])("rejects %s without calling the database", async (_label, who) => {
    const { rpc } = setupMocks(who);
    expect(await createEventAction({}, formDataOf(validEvent))).toEqual({ error: "Anda tidak memiliki akses." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the validation message and skips the RPC for an invalid form", async () => {
    const { rpc } = setupMocks();
    const result = await createEventAction({}, formDataOf({ ...validEvent, end_date: "2026-09-01" }));
    expect(result).toEqual({ error: "Tanggal selesai tidak boleh sebelum tanggal mulai" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database date-constraint violation to a friendly message", async () => {
    setupMocks({
      rpcError: { code: "23514", message: 'new row for relation "events" violates check constraint "events_dates"' },
    });
    expect(await createEventAction({}, formDataOf(validEvent))).toEqual({
      error: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    });
  });
});

describe("updateEventAction", () => {
  it("updates the event and its planned costs in one RPC, regardless of who created it", async () => {
    const { rpc } = setupMocks({ department: "Marketing" });

    const result = await updateEventAction({}, formDataOf({ ...validEvent, id: EVENT_ID, name: "Bazaar Lebaran" }));

    expect(result).toEqual({ success: true, id: EVENT_ID });
    expect(rpc).toHaveBeenCalledWith("update_event", {
      p_id: EVENT_ID,
      p_name: "Bazaar Lebaran",
      p_event_type: "Bazaar",
      p_start_date: "2026-09-28",
      p_end_date: "2026-10-03",
      p_region_id: REGION_ID,
      p_location: "Mall Taman Anggrek",
      p_pic_name: "Sari",
      p_target_participants: 1000,
      p_target_sales: 50000000,
      p_planned_budget: 20000000,
      p_planned_sample_budget: 5000000,
      ...noLinks,
    });
  });

  it("rejects a user outside Marketing/TM without calling the database", async () => {
    const { rpc } = setupMocks({ role: "finance", department: "Finance" });
    expect(await updateEventAction({}, formDataOf({ ...validEvent, id: EVENT_ID }))).toEqual({
      error: "Anda tidak memiliki akses.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a deleted or unknown event", async () => {
    setupMocks({ rpcError: { message: "EVENT_TIDAK_DITEMUKAN: event tidak ditemukan" } });
    expect(await updateEventAction({}, formDataOf({ ...validEvent, id: EVENT_ID }))).toEqual({
      error: "Event tidak ditemukan atau sudah dihapus.",
    });
  });
});

describe("deleteEventAction", () => {
  it("soft-deletes by setting deleted_at on an active event", async () => {
    const { update, updateEq, updateIs } = setupMocks();

    expect(await deleteEventAction(EVENT_ID)).toEqual({});
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", EVENT_ID);
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("reports an event that was already deleted or not updatable", async () => {
    setupMocks({ deletedRows: [] });
    expect(await deleteEventAction(EVENT_ID)).toEqual({ error: "Event tidak ditemukan atau sudah dihapus." });
  });

  it("rejects a user outside Marketing/TM without calling the database", async () => {
    const { update } = setupMocks({ role: "manager", department: "Sales" });
    expect(await deleteEventAction(EVENT_ID)).toEqual({ error: "Anda tidak memiliki akses." });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("searchEventCampaignsAction", () => {
  const skp = {
    id: "66666666-6666-4666-8666-666666666666",
    skp_number: "SKP/2026/09/001",
    name: "Bazaar Brand A",
    region_id: REGION_ID,
    distributor_id: null,
    brand_id: "22222222-2222-4222-8222-222222222222",
  };

  it("searches SKPs by number or title through the database function", async () => {
    const { rpc } = setupMocks();
    rpc.mockResolvedValueOnce({ data: [skp], error: null });

    expect(await searchEventCampaignsAction(" 2026/09 ")).toEqual({ campaigns: [skp] });
    expect(rpc).toHaveBeenCalledWith("search_event_campaigns", { p_query: "2026/09" });
  });

  it("skips queries shorter than two characters", async () => {
    const { rpc } = setupMocks();
    expect(await searchEventCampaignsAction("a")).toEqual({ campaigns: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a user outside Marketing/TM", async () => {
    const { rpc } = setupMocks({ role: "user", department: "Sales" });
    expect(await searchEventCampaignsAction("SKP")).toEqual({ campaigns: [], error: "Anda tidak memiliki akses." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateEventStatusAction", () => {
  it("marks a started event Terlaksana with its realization in one RPC", async () => {
    const { rpc } = setupMocks();

    const result = await updateEventStatusAction(
      {},
      formDataOf({
        id: EVENT_ID,
        status: "terlaksana",
        actual_participants: "850",
        actual_sales: "42000000",
        actual_budget: "19500000",
      })
    );

    expect(result).toEqual({ success: true, id: EVENT_ID });
    expect(rpc).toHaveBeenCalledWith("set_event_status", {
      p_id: EVENT_ID,
      p_status: "terlaksana",
      p_actual_participants: 850,
      p_actual_sales: 42000000,
      p_actual_budget: 19500000,
      p_cancel_reason: null,
    });
  });

  it("rejects Terlaksana for an event whose start date is still in the future", async () => {
    const { rpc } = setupMocks({ existingEvent: { start_date: "2999-01-01" } });
    expect(
      await updateEventStatusAction(
        {},
        formDataOf({ id: EVENT_ID, status: "terlaksana", actual_participants: "1", actual_sales: "1", actual_budget: "1" })
      )
    ).toEqual({ error: "Event belum dimulai, belum bisa ditandai Terlaksana" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cancels a future event with a reason and a forfeited budget", async () => {
    const { rpc } = setupMocks({ existingEvent: { start_date: "2999-01-01" } });
    expect(
      await updateEventStatusAction(
        {},
        formDataOf({ id: EVENT_ID, status: "batal", cancel_reason: "Venue batal", actual_budget: "2500000" })
      )
    ).toEqual({ success: true, id: EVENT_ID });
    expect(rpc).toHaveBeenCalledWith("set_event_status", {
      p_id: EVENT_ID,
      p_status: "batal",
      p_actual_participants: null,
      p_actual_sales: null,
      p_actual_budget: 2500000,
      p_cancel_reason: "Venue batal",
    });
  });

  it("returns the validation message for Batal without a reason", async () => {
    const { rpc } = setupMocks();
    expect(await updateEventStatusAction({}, formDataOf({ id: EVENT_ID, status: "batal" }))).toEqual({
      error: "Alasan batal harus diisi",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a deleted or unknown event", async () => {
    const { rpc } = setupMocks({ existingEvent: null });
    expect(await updateEventStatusAction({}, formDataOf({ id: EVENT_ID, status: "rencana" }))).toEqual({
      error: "Event tidak ditemukan atau sudah dihapus.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database rejection of an unstarted event to the same message", async () => {
    setupMocks({ rpcError: { message: "EVENT_BELUM_DIMULAI: event belum dimulai" } });
    expect(
      await updateEventStatusAction(
        {},
        formDataOf({ id: EVENT_ID, status: "terlaksana", actual_participants: "1", actual_sales: "1", actual_budget: "1" })
      )
    ).toEqual({ error: "Event belum dimulai, belum bisa ditandai Terlaksana" });
  });

  it("rejects a user outside Marketing/TM without calling the database", async () => {
    const { rpc } = setupMocks({ role: "manager", department: "Sales" });
    expect(await updateEventStatusAction({}, formDataOf({ id: EVENT_ID, status: "rencana" }))).toEqual({
      error: "Anda tidak memiliki akses.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveEventSamplingAction", () => {
  const row = { event_id: EVENT_ID, product_name: "Rice Cracker", quantity: "24", unit: "pcs", value: "360000" };

  it("adds a sampling row with its value in one RPC", async () => {
    const { rpc } = setupMocks();

    expect(await saveEventSamplingAction({}, formDataOf(row))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("save_event_sampling", {
      p_event_id: EVENT_ID,
      p_id: null,
      p_product_name: "Rice Cracker",
      p_quantity: 24,
      p_unit: "pcs",
      p_value: 360000,
    });
  });

  it("updates an existing row by id", async () => {
    const { rpc } = setupMocks();
    const SAMPLING_ID = "99999999-9999-4999-8999-999999999999";

    expect(await saveEventSamplingAction({}, formDataOf({ ...row, id: SAMPLING_ID, quantity: "30" }))).toEqual({
      success: true,
    });
    expect(rpc).toHaveBeenCalledWith("save_event_sampling", expect.objectContaining({ p_id: SAMPLING_ID, p_quantity: 30 }));
  });

  it("rejects a zero quantity before calling the database", async () => {
    const { rpc } = setupMocks();
    expect(await saveEventSamplingAction({}, formDataOf({ ...row, quantity: "0" }))).toEqual({
      error: "Qty harus lebih dari 0",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["event_samplings_quantity_check", "Qty harus lebih dari 0"],
    ["event_sampling_costs_value_check", "Nilai sampling tidak boleh negatif"],
    ["SAMPLING_TIDAK_DITEMUKAN: baris sampling tidak ditemukan", "Baris sampling tidak ditemukan atau sudah dihapus."],
    ["EVENT_TIDAK_DITEMUKAN: event tidak ditemukan", "Event tidak ditemukan atau sudah dihapus."],
  ])("maps the database error %s", async (message, error) => {
    setupMocks({ rpcError: { message } });
    expect(await saveEventSamplingAction({}, formDataOf(row))).toEqual({ error });
  });

  it("rejects a user outside Marketing/TM without calling the database", async () => {
    const { rpc } = setupMocks({ role: "finance", department: "Finance" });
    expect(await saveEventSamplingAction({}, formDataOf(row))).toEqual({ error: "Anda tidak memiliki akses." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("deleteEventSamplingAction", () => {
  const SAMPLING_ID = "99999999-9999-4999-8999-999999999999";

  it("soft deletes an active sampling row of the event", async () => {
    const { from, update, updateEq, updateIs } = setupMocks({ deletedRows: [{ id: SAMPLING_ID }] });

    expect(await deleteEventSamplingAction(EVENT_ID, SAMPLING_ID)).toEqual({});
    expect(from).toHaveBeenCalledWith("event_samplings");
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", SAMPLING_ID);
    expect(updateEq).toHaveBeenCalledWith("event_id", EVENT_ID);
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("reports a row that is already deleted or blocked by RLS", async () => {
    setupMocks({ deletedRows: [] });
    expect(await deleteEventSamplingAction(EVENT_ID, SAMPLING_ID)).toEqual({
      error: "Baris sampling tidak ditemukan atau sudah dihapus.",
    });
  });

  it("rejects a user outside Marketing/TM without touching the table", async () => {
    const { update } = setupMocks({ role: "manager", department: "Sales" });
    expect(await deleteEventSamplingAction(EVENT_ID, SAMPLING_ID)).toEqual({ error: "Anda tidak memiliki akses." });
    expect(update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createEventAction, deleteEventAction, updateEventAction } from "./event";
import { createClient } from "@/lib/supabase/server";

const NEW_ID = "77777777-7777-4777-8777-777777777777";
const EVENT_ID = "88888888-8888-4888-8888-888888888888";
const REGION_ID = "11111111-1111-4111-8111-111111111111";

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  rpcError = null,
  deletedRows = [{ id: EVENT_ID }],
}: {
  role?: string;
  department?: string | null;
  rpcError?: { message: string; code?: string } | null;
  deletedRows?: { id: string }[];
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcError ? null : NEW_ID, error: rpcError });
  const updateSelect = vi.fn().mockResolvedValue({ data: deletedRows, error: null });
  const updateIs = vi.fn().mockReturnValue({ select: updateSelect });
  const updateEq = vi.fn().mockReturnValue({ is: updateIs });
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
      if (table === "events") return { update };
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { rpc, update, updateEq, updateIs };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

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
    });
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

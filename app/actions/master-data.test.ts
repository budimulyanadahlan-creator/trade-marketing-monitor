import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveDistributorAction } from "./master-data";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeUserChain(profile: { role: string; is_active: boolean }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile }),
  };
}

function setupMocks({
  role = "admin",
  insertError = null,
}: { role?: string; insertError?: { message: string } | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeUserChain({ role, is_active: true });
      if (table === "distributors") return { insert, update };
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

  return { insert, update };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveDistributorAction", () => {
  it("inserts a new distributor with name and contact", async () => {
    const { insert } = setupMocks();

    const result = await saveDistributorAction(
      {},
      formDataOf({ name: "PT Distribusi Jaya", contact: "0811222333" })
    );

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      name: "PT Distribusi Jaya",
      contact: "0811222333",
      parent_distributor_id: null,
    });
  });

  it("stores empty contact as null", async () => {
    const { insert } = setupMocks();

    const result = await saveDistributorAction(
      {},
      formDataOf({ name: "PT Distribusi Jaya" })
    );

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      name: "PT Distribusi Jaya",
      contact: null,
      parent_distributor_id: null,
    });
  });

  it("rejects an empty name", async () => {
    setupMocks();

    const result = await saveDistributorAction({}, formDataOf({ name: "" }));

    expect(result.error).toBe("Nama distributor harus diisi");
  });

  it("rejects a non-admin user", async () => {
    const { insert } = setupMocks({ role: "user" });

    const result = await saveDistributorAction(
      {},
      formDataOf({ name: "PT Distribusi Jaya" })
    );

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// saveDistributorAction — perusahaan induk (Fase 2 multi-user distributor)
// -------------------------------------------------------

const edmId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mmsId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const birId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setupParentMocks({
  rows,
  childrenCount = 0,
}: {
  rows: Record<string, { id: string; parent_distributor_id: string | null }>;
  childrenCount?: number;
}) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const select = vi.fn().mockImplementation(() => ({
    eq: vi.fn().mockImplementation((col: string, val: string) => {
      if (col === "id") {
        return { maybeSingle: vi.fn().mockResolvedValue({ data: rows[val] ?? null }) };
      }
      return Promise.resolve({ count: childrenCount, error: null });
    }),
  }));

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeUserChain({ role: "admin", is_active: true });
      if (table === "distributors") return { insert, update, select };
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  return { insert, update };
}

describe("saveDistributorAction — perusahaan induk", () => {
  it("saves parent_distributor_id when the parent has no parent itself", async () => {
    const { update } = setupParentMocks({
      rows: { [edmId]: { id: edmId, parent_distributor_id: null } },
    });

    const result = await saveDistributorAction(
      {},
      formDataOf({ id: mmsId, name: "Mitra Monas Sejahtera", parent_distributor_id: edmId })
    );

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ parent_distributor_id: edmId })
    );
  });

  it("rejects a distributor pointing to itself as parent", async () => {
    const { update } = setupParentMocks({
      rows: { [edmId]: { id: edmId, parent_distributor_id: null } },
    });

    const result = await saveDistributorAction(
      {},
      formDataOf({ id: edmId, name: "Esham Dima", parent_distributor_id: edmId })
    );

    expect(result.error).toBe("Perusahaan induk tidak boleh perusahaan itu sendiri.");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects two levels: chosen parent already has a parent", async () => {
    const { update } = setupParentMocks({
      rows: { [mmsId]: { id: mmsId, parent_distributor_id: edmId } },
    });

    const result = await saveDistributorAction(
      {},
      formDataOf({ id: birId, name: "Bintang Indo Raya", parent_distributor_id: mmsId })
    );

    expect(result.error).toMatch(/maksimal satu tingkat/);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a cycle: distributor that already is a parent cannot take a parent", async () => {
    const { update } = setupParentMocks({
      rows: { [mmsId]: { id: mmsId, parent_distributor_id: edmId } },
      childrenCount: 2,
    });

    const result = await saveDistributorAction(
      {},
      formDataOf({ id: edmId, name: "Esham Dima", parent_distributor_id: mmsId })
    );

    expect(result.error).toMatch(/sudah menjadi induk/);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a parent that does not exist", async () => {
    const { insert } = setupParentMocks({ rows: {} });

    const result = await saveDistributorAction(
      {},
      formDataOf({ name: "Baru", parent_distributor_id: edmId })
    );

    expect(result.error).toBe("Perusahaan induk tidak ditemukan.");
    expect(insert).not.toHaveBeenCalled();
  });
});

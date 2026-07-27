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

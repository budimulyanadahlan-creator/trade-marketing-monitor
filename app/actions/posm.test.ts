import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deletePosmItemAction, savePosmItemAction, togglePosmItemActiveAction } from "./posm";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeUserChain(profile: { role: string; is_active: boolean; department: { name: string } | null }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile }),
  };
}

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  insertError = null,
}: {
  role?: string;
  department?: string | null;
  insertError?: { message: string; code?: string } | null;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const updateIs = vi.fn().mockResolvedValue({ error: null });
  const updateEq = vi.fn().mockReturnValue({ is: updateIs });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return makeUserChain({
          role,
          is_active: true,
          department: department ? { name: department } : null,
        });
      if (table === "posm_items") return { insert, update };
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

  return { insert, update, updateEq, updateIs };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const validItem = {
  code: "posm-0001",
  name: "Wobbler Promo Lebaran",
  category: "Wobbler",
  unit: "pcs",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("savePosmItemAction", () => {
  it("inserts a new item for a Trade Marketing user, upper-casing the code", async () => {
    const { insert } = setupMocks();

    const result = await savePosmItemAction({}, formDataOf(validItem));

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      code: "POSM-0001",
      name: "Wobbler Promo Lebaran",
      brand_id: null,
      category: "Wobbler",
      unit: "pcs",
      min_stock: null,
    });
  });

  it("stores brand and minimum stock when provided", async () => {
    const { insert } = setupMocks({ role: "admin", department: "Finance" });
    const brandId = "11111111-1111-4111-8111-111111111111";

    const result = await savePosmItemAction(
      {},
      formDataOf({ ...validItem, brand_id: brandId, min_stock: "50" })
    );

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ brand_id: brandId, min_stock: 50 })
    );
  });

  it("updates an existing, non-deleted item when an id is given", async () => {
    const { insert, update, updateEq, updateIs } = setupMocks({ role: "manager", department: "Marketing" });
    const id = "22222222-2222-4222-8222-222222222222";

    const result = await savePosmItemAction({}, formDataOf({ ...validItem, id, name: "Wobbler Baru" }));

    expect(result.success).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: "Wobbler Baru" }));
    expect(updateEq).toHaveBeenCalledWith("id", id);
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("rejects a user from a non-writer department", async () => {
    const { insert } = setupMocks({ department: "Sales" });

    const result = await savePosmItemAction({}, formDataOf(validItem));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects finance", async () => {
    const { insert } = setupMocks({ role: "finance", department: "Finance" });

    const result = await savePosmItemAction({}, formDataOf(validItem));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a category outside the fixed list", async () => {
    const { insert } = setupMocks();

    const result = await savePosmItemAction({}, formDataOf({ ...validItem, category: "Spanduk" }));

    expect(result.error).toBe("Kategori tidak valid");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a negative minimum stock", async () => {
    setupMocks();

    const result = await savePosmItemAction({}, formDataOf({ ...validItem, min_stock: "-1" }));

    expect(result.error).toBe("Stok minimum tidak boleh negatif");
  });

  it("returns a friendly message when the code is already used", async () => {
    setupMocks({ insertError: { message: "duplicate key value", code: "23505" } });

    const result = await savePosmItemAction({}, formDataOf(validItem));

    expect(result.error).toBe("Kode POSM-0001 sudah dipakai item lain. Gunakan kode lain.");
  });
});

describe("togglePosmItemActiveAction", () => {
  it("deactivates an item for a writer", async () => {
    const { update, updateEq } = setupMocks();

    const result = await togglePosmItemActiveAction("item-1", false);

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(updateEq).toHaveBeenCalledWith("id", "item-1");
  });

  it("rejects a non-writer", async () => {
    const { update } = setupMocks({ department: "Sales" });

    const result = await togglePosmItemActiveAction("item-1", false);

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("deletePosmItemAction", () => {
  it("soft-deletes by setting deleted_at instead of removing the row", async () => {
    const { update, updateEq } = setupMocks({ role: "superadmin", department: null });

    const result = await deletePosmItemAction("item-1");

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", "item-1");
  });

  it("rejects a non-writer", async () => {
    const { update } = setupMocks({ role: "manager", department: "Sales" });

    const result = await deletePosmItemAction("item-1");

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(update).not.toHaveBeenCalled();
  });
});

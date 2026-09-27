import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteGimmickItemAction, saveGimmickItemAction, toggleGimmickItemActiveAction } from "./gimmick";
import { createClient } from "@/lib/supabase/server";

type DbError = { message: string; code?: string } | null;

const NEW_ID = "77777777-7777-4777-8777-777777777777";

function setupMocks({
  role = "user",
  department = "Marketing",
  insertError = null,
  updateError = null,
}: {
  role?: string;
  department?: string | null;
  insertError?: DbError;
  updateError?: DbError;
} = {}) {
  const insertSingle = vi.fn().mockResolvedValue({ data: insertError ? null : { id: NEW_ID }, error: insertError });
  const insert = vi.fn().mockReturnValue({ select: () => ({ single: insertSingle }) });
  const updateIs = vi.fn().mockResolvedValue({ error: updateError });
  const updateEq = vi.fn().mockReturnValue({ is: updateIs });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role, is_active: true, department: department ? { name: department } : null },
          }),
        };
      if (table === "gimmick_items") return { insert, update };
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { insert, update, updateEq, updateIs, client };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const validItem = {
  code: "gmk-0001",
  name: "Payung Wangzai",
  category: "Payung",
  unit: "pcs",
  unit_cost: "45000",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveGimmickItemAction", () => {
  it("inserts a new item for a Marketing user, upper-casing the code", async () => {
    const { insert } = setupMocks();

    const result = await saveGimmickItemAction({}, formDataOf(validItem));

    expect(result).toEqual({ success: true, id: NEW_ID });
    expect(insert).toHaveBeenCalledWith({
      code: "GMK-0001",
      name: "Payung Wangzai",
      brand_id: null,
      category: "Payung",
      unit: "pcs",
      pcs_per_carton: null,
      unit_cost: 45000,
      suggested_price: null,
      min_stock: null,
      program: null,
    });
  });

  it("stores the optional fields when provided, trimming the program", async () => {
    const { insert } = setupMocks({ role: "admin", department: "Finance" });
    const brandId = "11111111-1111-4111-8111-111111111111";

    const result = await saveGimmickItemAction(
      {},
      formDataOf({
        ...validItem,
        brand_id: brandId,
        pcs_per_carton: "24",
        suggested_price: "60000",
        min_stock: "48",
        program: "  Imlek 2027 ",
      })
    );

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: brandId,
        pcs_per_carton: 24,
        suggested_price: 60000,
        min_stock: 48,
        program: "Imlek 2027",
      })
    );
  });

  it.each([
    [{ unit_cost: "" }, "Harga pokok harus diisi"],
    [{ unit_cost: "-1" }, "Harga pokok tidak boleh negatif"],
    [{ pcs_per_carton: "0" }, "Isi per karton harus lebih dari 0"],
    [{ pcs_per_carton: "2.5" }, "Isi per karton harus bilangan bulat"],
    [{ suggested_price: "-100" }, "Harga jual saran tidak boleh negatif"],
    [{ min_stock: "-1" }, "Stok minimum tidak boleh negatif"],
    [{ category: "Kaos" }, "Kategori tidak valid"],
    [{ unit: "lembar" }, "Satuan tidak valid"],
  ])("rejects invalid input %o", async (override, message) => {
    const { insert } = setupMocks();

    const result = await saveGimmickItemAction({}, formDataOf({ ...validItem, ...override }));

    expect(result.error).toBe(message);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ["user", "Sales"],
    ["manager", "Operations"],
    ["finance", "Finance"],
    ["user", null],
  ])("rejects a %s from the %s department", async (role, department) => {
    const { insert } = setupMocks({ role, department });

    const result = await saveGimmickItemAction({}, formDataOf(validItem));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("updates an existing, non-deleted item when an id is given", async () => {
    const { insert, update, updateEq, updateIs } = setupMocks({ role: "manager", department: "Trade Marketing" });
    const id = "22222222-2222-4222-8222-222222222222";

    const result = await saveGimmickItemAction({}, formDataOf({ ...validItem, id, unit_cost: "50000" }));

    expect(result).toEqual({ success: true, id });
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ unit_cost: 50000, program: null }));
    expect(updateEq).toHaveBeenCalledWith("id", id);
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("returns a friendly message when the code is already used", async () => {
    setupMocks({ insertError: { message: "duplicate key value", code: "23505" } });

    const result = await saveGimmickItemAction({}, formDataOf(validItem));

    expect(result.error).toBe("Kode GMK-0001 sudah dipakai item gimmick lain. Gunakan kode lain.");
  });

  it("returns the same message when an edit collides with another code", async () => {
    setupMocks({ updateError: { message: "duplicate key value", code: "23505" } });

    const result = await saveGimmickItemAction(
      {},
      formDataOf({ ...validItem, id: "22222222-2222-4222-8222-222222222222" })
    );

    expect(result.error).toBe("Kode GMK-0001 sudah dipakai item gimmick lain. Gunakan kode lain.");
  });

  it("accepts a zero unit cost", async () => {
    const { insert } = setupMocks();

    const result = await saveGimmickItemAction({}, formDataOf({ ...validItem, unit_cost: "0" }));

    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ unit_cost: 0 }));
  });
});

describe("toggleGimmickItemActiveAction", () => {
  it("deactivates a non-deleted item for a writer", async () => {
    const { update, updateEq, updateIs } = setupMocks();

    const result = await toggleGimmickItemActiveAction("item-1", false);

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(updateEq).toHaveBeenCalledWith("id", "item-1");
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("rejects a non-writer", async () => {
    const { update } = setupMocks({ department: "Sales" });

    const result = await toggleGimmickItemActiveAction("item-1", true);

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("deleteGimmickItemAction", () => {
  it("soft-deletes by setting deleted_at instead of removing the row", async () => {
    const { update, updateEq, updateIs } = setupMocks({ role: "superadmin", department: null });

    const result = await deleteGimmickItemAction("item-1");

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", "item-1");
    expect(updateIs).toHaveBeenCalledWith("deleted_at", null);
  });

  it("rejects a non-writer", async () => {
    const { update } = setupMocks({ role: "finance", department: "Finance" });

    const result = await deleteGimmickItemAction("item-1");

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(update).not.toHaveBeenCalled();
  });
});

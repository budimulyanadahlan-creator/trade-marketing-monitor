import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  deletePosmItemAction,
  deletePosmMovementAction,
  savePosmItemAction,
  savePosmMovementAction,
  togglePosmItemActiveAction,
} from "./posm";
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

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

// Tabel palsu: select().eq().is() difilter dari `rows`, lalu bisa di-await
// (list atau count) atau diakhiri maybeSingle(). insert/update hanya dicatat.
function fakeTable(rows: Row[], { insertError = null, updateError = null }: { insertError?: DbError; updateError?: DbError } = {}) {
  const select = vi.fn((_cols?: string, opts?: { count?: string }) => {
    const filters: { key: string; value: unknown }[] = [];
    const run = () => rows.filter((r) => filters.every((f) => (r[f.key] ?? null) === f.value));
    const query = {
      eq: (key: string, value: unknown) => (filters.push({ key, value }), query),
      is: (key: string, value: unknown) => (filters.push({ key, value }), query),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(opts?.count ? { count: run().length, error: null } : { data: run(), error: null }).then(
          resolve,
          reject
        ),
    };
    return query;
  });
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const updateIs = vi.fn().mockResolvedValue({ error: updateError });
  const updateEq = vi.fn().mockReturnValue({ is: updateIs });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  return { select, insert, update, updateEq, updateIs };
}

const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const REGION_ID = "44444444-4444-4444-8444-444444444444";

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  insertError = null,
  items = [{ id: ITEM_ID, is_active: true, unit: "pcs", deleted_at: null }],
  movements = [],
  movementError = null,
}: {
  role?: string;
  department?: string | null;
  insertError?: DbError;
  items?: Row[];
  movements?: Row[];
  movementError?: DbError;
} = {}) {
  const itemsTable = fakeTable(items, { insertError });
  const movementsTable = fakeTable(movements, { insertError: movementError, updateError: movementError });

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
      if (table === "posm_items") return itemsTable;
      if (table === "posm_movements") return movementsTable;
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

  const { insert, update, updateEq, updateIs } = itemsTable;
  return { insert, update, updateEq, updateIs, movements: movementsTable };
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

describe("deletePosmItemAction with stock movements", () => {
  it("refuses to delete an item that has movements, even soft-deleted ones", async () => {
    const { update } = setupMocks({
      movements: [{ id: "m1", item_id: ITEM_ID, movement_date: "2026-01-01", quantity: 10, deleted_at: "2026-01-02" }],
    });

    const result = await deletePosmItemAction(ITEM_ID);

    expect(result.error).toBe("Item sudah punya mutasi stok dan tidak bisa dihapus. Nonaktifkan saja.");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("savePosmMovementAction", () => {
  const base = { item_id: ITEM_ID, movement_date: "2026-01-10" };

  it("records an incoming movement with a positive quantity", async () => {
    const { movements } = setupMocks();

    const result = await savePosmMovementAction(
      {},
      formDataOf({ ...base, type: "in", quantity: "100", notes: "Dari percetakan" })
    );

    expect(result.success).toBe(true);
    expect(movements.insert).toHaveBeenCalledWith({
      item_id: ITEM_ID,
      movement_date: "2026-01-10",
      type: "in",
      quantity: 100,
      region_id: null,
      notes: "Dari percetakan",
    });
  });
});

describe("savePosmMovementAction balance rules", () => {
  const stock = [
    { id: "m-in", item_id: ITEM_ID, movement_date: "2026-01-05", quantity: 100, deleted_at: null },
    { id: "m-out", item_id: ITEM_ID, movement_date: "2026-01-20", quantity: -80, deleted_at: null },
    // Mutasi terhapus tidak dihitung dalam saldo.
    { id: "m-gone", item_id: ITEM_ID, movement_date: "2026-01-06", quantity: 500, deleted_at: "2026-01-07" },
  ];
  const out = (qty: string, date = "2026-01-10") => ({
    item_id: ITEM_ID,
    movement_date: date,
    type: "out",
    quantity: qty,
    region_id: REGION_ID,
  });

  it("stores an out movement as a negative quantity with its region", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await savePosmMovementAction({}, formDataOf(out("20")));

    expect(result.success).toBe(true);
    expect(movements.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "out", quantity: -20, region_id: REGION_ID })
    );
  });

  it("rejects an out that would push a later balance negative and shows what is available", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await savePosmMovementAction({}, formDataOf(out("21")));

    expect(result.error).toBe("Saldo tidak cukup. Saldo tersedia per 10 Jan 2026: 20 pcs.");
    expect(movements.insert).not.toHaveBeenCalled();
  });

  it("rejects an out backdated before the stock came in", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await savePosmMovementAction({}, formDataOf(out("5", "2026-01-01")));

    expect(result.error).toBe("Saldo tidak cukup. Saldo tersedia per 1 Jan 2026: 0 pcs.");
    expect(movements.insert).not.toHaveBeenCalled();
  });

  it("requires a region for out", async () => {
    const { movements } = setupMocks({ movements: stock });
    const noRegion = { ...out("5"), region_id: "" };

    const result = await savePosmMovementAction({}, formDataOf(noRegion));

    expect(result.error).toBe("Region tujuan harus diisi untuk mutasi Keluar");
    expect(movements.insert).not.toHaveBeenCalled();
  });

  it("signs a minus adjustment and requires a reason", async () => {
    const { movements } = setupMocks({ movements: stock });
    const adj = { item_id: ITEM_ID, movement_date: "2026-01-25", type: "adjustment", quantity: "3", direction: "minus" };

    expect((await savePosmMovementAction({}, formDataOf(adj))).error).toBe("Alasan penyesuaian harus diisi");

    const result = await savePosmMovementAction({}, formDataOf({ ...adj, notes: "Rusak saat stock opname" }));
    expect(result.success).toBe(true);
    expect(movements.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "adjustment", quantity: -3, region_id: null })
    );
  });

  it("rejects new movements on an inactive item", async () => {
    const { movements } = setupMocks({ items: [{ id: ITEM_ID, is_active: false, unit: "pcs", deleted_at: null }] });

    const result = await savePosmMovementAction(
      {},
      formDataOf({ item_id: ITEM_ID, movement_date: "2026-01-10", type: "in", quantity: "5" })
    );

    expect(result.error).toBe("Item nonaktif tidak bisa diberi mutasi baru. Aktifkan item terlebih dahulu.");
    expect(movements.insert).not.toHaveBeenCalled();
  });

  it("turns the database balance guard into a friendly message", async () => {
    setupMocks({ movementError: { message: "POSM_SALDO_NEGATIF: saldo pada 2026-01-10 menjadi -3", code: "P0001" } });

    const result = await savePosmMovementAction(
      {},
      formDataOf({ item_id: ITEM_ID, movement_date: "2026-01-10", type: "in", quantity: "5" })
    );

    expect(result.error).toBe(
      "Saldo tidak cukup karena data stok baru saja berubah. Muat ulang halaman lalu coba lagi."
    );
  });

  it("rejects a non-writer", async () => {
    const { movements } = setupMocks({ role: "finance", department: "Finance" });

    const result = await savePosmMovementAction({}, formDataOf(out("5")));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(movements.insert).not.toHaveBeenCalled();
  });
});

describe("editing and deleting movements", () => {
  const IN_ID = "55555555-5555-4555-8555-555555555555";
  const OUT_ID = "66666666-6666-4666-8666-666666666666";
  const stock = [
    { id: IN_ID, item_id: ITEM_ID, movement_date: "2026-01-05", quantity: 100, created_by: "other-user", deleted_at: null },
    { id: OUT_ID, item_id: ITEM_ID, movement_date: "2026-01-20", quantity: -80, created_by: "other-user", deleted_at: null },
  ];
  const editIn = (qty: string) =>
    formDataOf({ id: IN_ID, item_id: ITEM_ID, movement_date: "2026-01-05", type: "in", quantity: qty });

  it("rejects shrinking an in when a later out would go negative", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await savePosmMovementAction({}, editIn("70"));

    expect(result.error).toBe("Perubahan ini membuat saldo pada 20 Jan 2026 menjadi -10 pcs.");
    expect(movements.update).not.toHaveBeenCalled();
  });

  it("updates someone else's movement in place when the balance stays valid", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await savePosmMovementAction({}, editIn("90"));

    expect(result.success).toBe(true);
    expect(movements.insert).not.toHaveBeenCalled();
    expect(movements.update).toHaveBeenCalledWith(expect.objectContaining({ quantity: 90 }));
    expect(movements.updateEq).toHaveBeenCalledWith("id", IN_ID);
  });

  it("refuses to delete an in that later outs depend on", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await deletePosmMovementAction(IN_ID);

    expect(result.error).toBe("Mutasi ini tidak bisa dihapus karena saldo pada 20 Jan 2026 menjadi -80 pcs.");
    expect(movements.update).not.toHaveBeenCalled();
  });

  it("soft-deletes a movement when the balance stays valid", async () => {
    const { movements } = setupMocks({ movements: stock });

    const result = await deletePosmMovementAction(OUT_ID);

    expect(result.error).toBeUndefined();
    expect(movements.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(movements.updateEq).toHaveBeenCalledWith("id", OUT_ID);
  });

  it("rejects a non-writer", async () => {
    const { movements } = setupMocks({ department: "Sales", movements: stock });

    const result = await deletePosmMovementAction(OUT_ID);

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(movements.update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteGimmickMovementAction, saveGimmickMovementAction } from "./gimmick";
import { createClient } from "@/lib/supabase/server";

const ITEM = "11111111-1111-4111-8111-111111111111";
const OTHER_ITEM = "22222222-2222-4222-8222-222222222222";
const MOVEMENT = "33333333-3333-4333-8333-333333333333";

type Item = { id: string; is_active: boolean; unit: string; pcs_per_carton: number | null };
type Movement = { id: string; item_id: string; movement_date: string; quantity: number };

/** Query builder berantai yang bisa di-await; filter eq/is dicatat untuk diperiksa. */
function query<T>(rows: T[]) {
  const filters: Record<string, unknown> = {};
  const matching = () =>
    rows.filter((r) =>
      Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === undefined || (r as Record<string, unknown>)[k] === v)
    );
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((k: string, v: unknown) => ((filters[k] = v), builder)),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: matching()[0] ?? null })),
    then: (resolve: (v: { data: T[] }) => unknown) => resolve({ data: matching() }),
  };
  return builder;
}

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  items = [{ id: ITEM, is_active: true, unit: "pcs", pcs_per_carton: 24 }] as Item[],
  movements = [] as Movement[],
  writeError = null as { message: string } | null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: writeError });
  const updateIs = vi.fn().mockResolvedValue({ error: writeError });
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
      if (table === "gimmick_items") return query(items);
      if (table === "gimmick_movements") return { ...query(movements), insert, update };
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { insert, update, updateEq, updateIs };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const incoming = { item_id: ITEM, movement_date: "2026-09-01", type: "in", cartons: "3", pcs: "5" };
const NO_DESTINATION = { destination: null, region_id: null, distributor_id: null, campaign_id: null, recipient_name: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveGimmickMovementAction", () => {
  it("stores 3 cartons + 5 pcs of a 24-per-carton item as 77 pcs, without a client price", async () => {
    const { insert } = setupMocks();

    const result = await saveGimmickMovementAction({}, formDataOf({ ...incoming, unit_cost_snapshot: "1" }));

    expect(result).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith({
      item_id: ITEM,
      movement_date: "2026-09-01",
      type: "in",
      quantity: 77,
      notes: null,
      ...NO_DESTINATION,
    });
  });
});

describe("saveGimmickMovementAction — validation", () => {
  it("requires a reason for an adjustment and accepts minus adjustments within the balance", async () => {
    const stock = [{ id: "m1", item_id: ITEM, movement_date: "2026-09-01", quantity: 77 }];
    const { insert } = setupMocks({ movements: stock });
    const adjustment = { ...incoming, type: "adjustment", direction: "minus", cartons: "0", pcs: "2" };

    expect((await saveGimmickMovementAction({}, formDataOf(adjustment))).error).toBe("Alasan penyesuaian harus diisi");
    expect(insert).not.toHaveBeenCalled();

    const result = await saveGimmickMovementAction({}, formDataOf({ ...adjustment, notes: "rusak" }));
    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: "adjustment", quantity: -2, notes: "rusak" }));
  });

  it("rejects a minus adjustment that exceeds the balance and shows the available stock", async () => {
    const stock = [{ id: "m1", item_id: ITEM, movement_date: "2026-09-01", quantity: 77 }];
    const { insert } = setupMocks({ movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...incoming, type: "adjustment", direction: "minus", cartons: "4", pcs: "0", notes: "hilang" })
    );

    expect(result.error).toBe("Saldo tidak cukup. Saldo tersedia per 1 Sep 2026: 77 pcs (3 krt + 5 pcs).");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity and ignores cartons for items without a carton size", async () => {
    const { insert } = setupMocks({ items: [{ id: ITEM, is_active: true, unit: "set", pcs_per_carton: null }] });

    expect((await saveGimmickMovementAction({}, formDataOf({ ...incoming, cartons: "0", pcs: "" }))).error).toBe(
      "Qty harus lebih dari 0"
    );
    await saveGimmickMovementAction({}, formDataOf({ ...incoming, cartons: "3", pcs: "5" }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }));
  });

  it("rejects a non-writer", async () => {
    const { insert } = setupMocks({ role: "manager", department: "Sales" });

    expect((await saveGimmickMovementAction({}, formDataOf(incoming))).error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("saveGimmickMovementAction — Keluar", () => {
  const REGION = "44444444-4444-4444-8444-444444444444";
  const DISTRIBUTOR = "55555555-5555-4555-8555-555555555555";
  const CAMPAIGN = "66666666-6666-4666-8666-666666666666";
  const stock = [{ id: "m1", item_id: ITEM, movement_date: "2026-09-01", quantity: 77 }];
  const outgoing = { ...incoming, type: "out", cartons: "1", pcs: "0" };

  it("stores a negative quantity with region, distributor, SKP and PIC", async () => {
    const { insert } = setupMocks({ movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({
        ...outgoing,
        destination: "region_distributor",
        region_id: REGION,
        distributor_id: DISTRIBUTOR,
        campaign_id: CAMPAIGN,
        recipient_name: " Pak Budi ",
      })
    );

    expect(result).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith({
      item_id: ITEM,
      movement_date: "2026-09-01",
      type: "out",
      quantity: -24,
      notes: null,
      destination: "region_distributor",
      region_id: REGION,
      distributor_id: DISTRIBUTOR,
      campaign_id: CAMPAIGN,
      recipient_name: "Pak Budi",
    });
  });

  it("rejects Keluar without a destination, a region, or a description", async () => {
    const { insert } = setupMocks({ movements: stock });

    expect((await saveGimmickMovementAction({}, formDataOf(outgoing))).error).toBe("Pilih tujuan keluar");
    expect(
      (await saveGimmickMovementAction({}, formDataOf({ ...outgoing, destination: "region_distributor" }))).error
    ).toBe("Region tujuan harus diisi");
    expect((await saveGimmickMovementAction({}, formDataOf({ ...outgoing, destination: "internal" }))).error).toBe(
      "Keterangan keperluan internal harus diisi"
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("drops the region and distributor for Internal", async () => {
    const { insert } = setupMocks({ movements: stock });

    await saveGimmickMovementAction(
      {},
      formDataOf({ ...outgoing, destination: "internal", region_id: REGION, distributor_id: DISTRIBUTOR, notes: "Hadiah HUT" })
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ destination: "internal", region_id: null, distributor_id: null, notes: "Hadiah HUT" })
    );
  });

  it("rejects Keluar above the available balance", async () => {
    const { insert } = setupMocks({ movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...outgoing, cartons: "4", destination: "event", notes: "Pameran" })
    );

    expect(result.error).toBe("Saldo tidak cukup. Saldo tersedia per 1 Sep 2026: 77 pcs (3 krt + 5 pcs).");
    expect(insert).not.toHaveBeenCalled();
  });

  it("translates a destination check-constraint error from the database", async () => {
    setupMocks({
      movements: stock,
      writeError: { message: 'new row violates check constraint "gimmick_movements_destination_region"' },
    });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...outgoing, destination: "region_distributor", region_id: REGION })
    );

    expect(result.error).toBe("Region tujuan harus diisi");
  });
});

describe("saveGimmickMovementAction — edit", () => {
  it("updates qty and date without sending the item or a price, so the snapshot is kept", async () => {
    const stock = [
      { id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 },
      { id: "m2", item_id: ITEM, movement_date: "2026-09-05", quantity: -10 },
    ];
    const { update, updateEq } = setupMocks({ movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...incoming, id: MOVEMENT, movement_date: "2026-09-02", cartons: "1", pcs: "0" })
    );

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith({ movement_date: "2026-09-02", type: "in", quantity: 24, notes: null, ...NO_DESTINATION });
    expect(updateEq).toHaveBeenCalledWith("id", MOVEMENT);
  });

  it("rejects an edit that makes a later balance negative", async () => {
    const stock = [
      { id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 },
      { id: "m2", item_id: ITEM, movement_date: "2026-09-05", quantity: -50 },
    ];
    const { update } = setupMocks({ movements: stock });

    const result = await saveGimmickMovementAction({}, formDataOf({ ...incoming, id: MOVEMENT, cartons: "1", pcs: "0" }));

    expect(result.error).toBe("Perubahan ini membuat saldo pada 5 Sep 2026 menjadi -26 pcs (1 krt + 2 pcs).");
    expect(update).not.toHaveBeenCalled();
  });

  it("sends the new item when the item is changed, so the database re-takes the snapshot", async () => {
    const items = [
      { id: ITEM, is_active: true, unit: "pcs", pcs_per_carton: 24 },
      { id: OTHER_ITEM, is_active: true, unit: "pcs", pcs_per_carton: 80 },
    ];
    const stock = [{ id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 }];
    const { update } = setupMocks({ items, movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...incoming, id: MOVEMENT, item_id: OTHER_ITEM, cartons: "1", pcs: "0" })
    );

    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ item_id: OTHER_ITEM, quantity: 80 }));
  });

  it("rejects changing the item when the previous item balance would go negative", async () => {
    const items = [
      { id: ITEM, is_active: true, unit: "pcs", pcs_per_carton: 24 },
      { id: OTHER_ITEM, is_active: true, unit: "pcs", pcs_per_carton: 80 },
    ];
    const stock = [
      { id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 },
      { id: "m2", item_id: ITEM, movement_date: "2026-09-05", quantity: -10 },
    ];
    const { update } = setupMocks({ items, movements: stock });

    const result = await saveGimmickMovementAction(
      {},
      formDataOf({ ...incoming, id: MOVEMENT, item_id: OTHER_ITEM, cartons: "1", pcs: "0" })
    );

    expect(result.error).toBe("Item tidak bisa diganti karena saldo item sebelumnya pada 5 Sep 2026 menjadi -10.");
    expect(update).not.toHaveBeenCalled();
  });

  it("does not allow moving a transaction onto an inactive item", async () => {
    const items = [
      { id: ITEM, is_active: true, unit: "pcs", pcs_per_carton: 24 },
      { id: OTHER_ITEM, is_active: false, unit: "pcs", pcs_per_carton: 80 },
    ];
    const stock = [{ id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 }];
    const { update } = setupMocks({ items, movements: stock });

    const result = await saveGimmickMovementAction({}, formDataOf({ ...incoming, id: MOVEMENT, item_id: OTHER_ITEM }));

    expect(result.error).toMatch(/Item nonaktif/);
    expect(update).not.toHaveBeenCalled();
  });

  it("translates the database balance error into a reload hint", async () => {
    setupMocks({ writeError: { message: "GIMMICK_SALDO_NEGATIF: saldo pada 2026-09-01 menjadi -1" } });

    const result = await saveGimmickMovementAction({}, formDataOf(incoming));

    expect(result.error).toMatch(/Muat ulang halaman/);
  });
});

describe("deleteGimmickMovementAction", () => {
  it("soft-deletes a movement that keeps the balance non-negative", async () => {
    const stock = [
      { id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 },
      { id: "m2", item_id: ITEM, movement_date: "2026-09-02", quantity: 10 },
    ];
    const { update, updateEq } = setupMocks({ movements: stock });

    expect(await deleteGimmickMovementAction("m2")).toEqual({});
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", "m2");
  });

  it("rejects deleting stock that was already given out", async () => {
    const stock = [
      { id: MOVEMENT, item_id: ITEM, movement_date: "2026-09-01", quantity: 77 },
      { id: "m2", item_id: ITEM, movement_date: "2026-09-05", quantity: -10 },
    ];
    const { update } = setupMocks({ movements: stock });

    const result = await deleteGimmickMovementAction(MOVEMENT);

    expect(result.error).toBe("Mutasi ini tidak bisa dihapus karena saldo pada 5 Sep 2026 menjadi -10 pcs.");
    expect(update).not.toHaveBeenCalled();
  });
});

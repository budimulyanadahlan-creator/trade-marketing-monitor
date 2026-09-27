import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteAssetPlacementAction, saveAssetPlacementAction } from "./posm";
import { createClient } from "@/lib/supabase/server";

type DbError = { message: string; code?: string } | null;
type Placement = { id: string; asset_id?: string; event_date: string; is_registration: boolean };

const ASSET_ID = "77777777-7777-4777-8777-777777777777";
const REG_ID = "88888888-8888-4888-8888-888888888888";
const MOVE_ID = "99999999-9999-4999-8999-999999999999";
const NEW_PLACEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REGION_ID = "44444444-4444-4444-8444-444444444444";
const DISTRIBUTOR_ID = "55555555-5555-4555-8555-555555555555";

// Query builder berantai: resolve ke hasil tulis jika insert/update dipanggil,
// selain itu ke hasil baca tabel.
function builder(read: { data: unknown }, write: { error: DbError }) {
  let writing = false;
  const b: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const m of ["select", "eq", "is", "order"]) b[m] = vi.fn(() => b);
  for (const m of ["insert", "update"])
    b[m] = vi.fn(() => {
      writing = true;
      return b;
    });
  b.maybeSingle = vi.fn(() => Promise.resolve(read));
  // insert().select("id").single() mengembalikan id catatan baru.
  b.single = vi.fn(() =>
    Promise.resolve(writing ? { data: write.error ? null : { id: NEW_PLACEMENT_ID }, ...write } : read)
  );
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(writing ? write : read).then(resolve, reject);
  return b;
}

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  assetExists = true,
  placements = [{ id: REG_ID, asset_id: ASSET_ID, event_date: "2026-01-10", is_registration: true }] as Placement[],
  writeError = null,
}: {
  role?: string;
  department?: string | null;
  assetExists?: boolean;
  placements?: Placement[];
  writeError?: DbError;
} = {}) {
  const calls: Record<string, ReturnType<typeof builder>[]> = { marketing_assets: [], asset_placements: [] };

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
      const read =
        table === "marketing_assets"
          ? { data: assetExists ? { id: ASSET_ID } : null }
          : { data: placements };
      // maybeSingle pada asset_placements = cari satu catatan.
      const b = builder(read, { error: writeError });
      if (table === "asset_placements")
        b.maybeSingle = vi.fn(() => {
          const id = b.eq.mock.calls.find((c) => c[0] === "id")?.[1];
          return Promise.resolve({ data: placements.find((p) => p.id === id) ?? null });
        });
      calls[table]?.push(b);
      return b;
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

  const writes = (table: string, op: "insert" | "update") =>
    calls[table].filter((b) => b[op].mock.calls.length > 0).map((b) => ({ args: b[op].mock.calls[0][0], b }));
  return { client, writes };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const moveToStore = {
  asset_id: ASSET_ID,
  event_date: "2026-03-05",
  destination: "placed",
  region_id: REGION_ID,
  distributor_id: DISTRIBUTOR_ID,
  store_name: "Toko Maju Jaya",
  store_address: "Jl. Merdeka 10",
  pic_name: "Pak Budi",
  condition: "Baik",
  notes: "Program display Q1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveAssetPlacementAction (move)", () => {
  it("records a move to a store as a new placement", async () => {
    const { writes } = setupMocks();

    const result = await saveAssetPlacementAction({}, formDataOf(moveToStore));

    expect(result.success).toBe(true);
    const inserts = writes("asset_placements", "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args).toEqual({
      asset_id: ASSET_ID,
      event_date: "2026-03-05",
      destination: "placed",
      region_id: REGION_ID,
      distributor_id: DISTRIBUTOR_ID,
      store_name: "Toko Maju Jaya",
      store_address: "Jl. Merdeka 10",
      pic_name: "Pak Budi",
      condition: "Baik",
      notes: "Program display Q1",
    });
  });

  it("returns the new placement id so its photo can be uploaded", async () => {
    setupMocks();

    const result = await saveAssetPlacementAction({}, formDataOf(moveToStore));

    expect(result).toEqual({ success: true, id: NEW_PLACEMENT_ID });
  });
});

describe("saveAssetPlacementAction dates", () => {
  it("rejects a move dated before the asset registration", async () => {
    const { writes } = setupMocks();

    const result = await saveAssetPlacementAction({}, formDataOf({ ...moveToStore, event_date: "2026-01-09" }));

    expect(result.error).toBe("Tanggal perpindahan tidak boleh sebelum tanggal pendaftaran asset (10 Jan 2026).");
    expect(writes("asset_placements", "insert")).toHaveLength(0);
  });
});

describe("saveAssetPlacementAction (edit)", () => {
  const history: Placement[] = [
    { id: REG_ID, asset_id: ASSET_ID, event_date: "2026-01-10", is_registration: true },
    { id: MOVE_ID, asset_id: ASSET_ID, event_date: "2026-03-05", is_registration: false },
  ];

  it("updates the record in place and drops store details for the warehouse", async () => {
    const { writes } = setupMocks({ placements: history });

    const result = await saveAssetPlacementAction(
      {},
      formDataOf({ ...moveToStore, id: MOVE_ID, destination: "warehouse", condition: "Rusak Ringan" })
    );

    expect(result.success).toBe(true);
    expect(writes("asset_placements", "insert")).toHaveLength(0);
    const [update] = writes("asset_placements", "update");
    expect(update.args).toEqual({
      event_date: "2026-03-05",
      destination: "warehouse",
      region_id: null,
      distributor_id: null,
      store_name: null,
      store_address: null,
      pic_name: "Pak Budi",
      condition: "Rusak Ringan",
      notes: "Program display Q1",
    });
    expect(update.b.eq).toHaveBeenCalledWith("id", MOVE_ID);
    expect(update.b.eq).toHaveBeenCalledWith("asset_id", ASSET_ID);
    expect(update.b.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("keeps the registration as the earliest record", async () => {
    const { writes } = setupMocks({ placements: history });

    const result = await saveAssetPlacementAction(
      {},
      formDataOf({ ...moveToStore, id: REG_ID, event_date: "2026-04-01" })
    );

    expect(result.error).toBe("Tanggal pendaftaran tidak boleh melewati perpindahan pertama (5 Mar 2026).");
    expect(writes("asset_placements", "update")).toHaveLength(0);
  });

  it("explains the database date guard when data changed meanwhile", async () => {
    setupMocks({
      placements: history,
      writeError: { message: "ASSET_TANGGAL_SEBELUM_PENDAFTARAN: tanggal sebelum pendaftaran asset" },
    });

    const result = await saveAssetPlacementAction({}, formDataOf(moveToStore));

    expect(result.error).toBe(
      "Tanggal tidak sesuai urutan riwayat karena data baru saja berubah. Muat ulang halaman lalu coba lagi."
    );
  });
});

describe("saveAssetPlacementAction access and validation", () => {
  it("rejects a non-writer", async () => {
    const { writes } = setupMocks({ role: "manager", department: "Sales" });

    const result = await saveAssetPlacementAction({}, formDataOf(moveToStore));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(writes("asset_placements", "insert")).toHaveLength(0);
  });

  it("requires a store name for a placed asset", async () => {
    setupMocks();

    const result = await saveAssetPlacementAction({}, formDataOf({ ...moveToStore, store_name: "" }));

    expect(result.error).toBe("Nama toko harus diisi untuk asset yang ditempatkan");
  });

  it("refuses to move a deleted asset", async () => {
    const { writes } = setupMocks({ assetExists: false });

    const result = await saveAssetPlacementAction({}, formDataOf(moveToStore));

    expect(result.error).toBe("Asset tidak ditemukan.");
    expect(writes("asset_placements", "insert")).toHaveLength(0);
  });
});

describe("deleteAssetPlacementAction", () => {
  const history: Placement[] = [
    { id: REG_ID, asset_id: ASSET_ID, event_date: "2026-01-10", is_registration: true },
    { id: MOVE_ID, asset_id: ASSET_ID, event_date: "2026-03-05", is_registration: false },
  ];

  it("soft-deletes a move so the asset falls back to the previous record", async () => {
    const { writes } = setupMocks({ placements: history });

    const result = await deleteAssetPlacementAction(MOVE_ID);

    expect(result.error).toBeUndefined();
    const [update] = writes("asset_placements", "update");
    expect(update.args).toEqual({ deleted_at: expect.any(String) });
    expect(update.b.eq).toHaveBeenCalledWith("id", MOVE_ID);
    expect(update.b.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("refuses to delete the registration record", async () => {
    const { writes } = setupMocks({ placements: history });

    const result = await deleteAssetPlacementAction(REG_ID);

    expect(result.error).toBe("Catatan pendaftaran tidak bisa dihapus. Edit catatan ini jika ada data yang salah.");
    expect(writes("asset_placements", "update")).toHaveLength(0);
  });

  it("reports a missing record", async () => {
    setupMocks({ placements: history });

    const result = await deleteAssetPlacementAction("00000000-0000-4000-8000-000000000000");

    expect(result.error).toBe("Catatan penempatan tidak ditemukan.");
  });

  it("rejects a non-writer", async () => {
    const { writes } = setupMocks({ role: "finance", department: "Finance", placements: history });

    const result = await deleteAssetPlacementAction(MOVE_ID);

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(writes("asset_placements", "update")).toHaveLength(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { moveMarketingAssetsBulkAction } from "./posm";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type DbError = { message: string; code?: string } | null;

const ASSET_1 = "11111111-1111-4111-8111-111111111111";
const ASSET_2 = "22222222-2222-4222-8222-222222222222";
const ASSET_3 = "33333333-3333-4333-8333-333333333333";
const REGION_ID = "44444444-4444-4444-8444-444444444444";
const DISTRIBUTOR_ID = "55555555-5555-4555-8555-555555555555";

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  rpcError = null,
  rpcData = ["p-1", "p-2", "p-3"] as unknown,
}: {
  role?: string;
  department?: string | null;
  rpcError?: DbError;
  rpcData?: unknown;
} = {}) {
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: rpcError ? null : rpcData, error: rpcError }),
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
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}

function formDataOf(entries: Record<string, string>, assetIds: string[] = [ASSET_1, ASSET_2, ASSET_3]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  for (const id of assetIds) fd.append("asset_id", id);
  return fd;
}

const toStore = {
  event_date: "2026-03-01",
  destination: "placed",
  region_id: REGION_ID,
  distributor_id: DISTRIBUTOR_ID,
  store_name: "Hotel Haris",
  store_address: "Jl. Merdeka 1",
  pic_name: "Bu Rina",
  condition: "keep",
  notes: "Event Agustusan",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moveMarketingAssetsBulkAction", () => {
  it("moves every selected unit to one store in one RPC, keeping each unit's condition", async () => {
    const client = setupMocks();
    const result = await moveMarketingAssetsBulkAction({}, formDataOf(toStore));

    expect(result).toEqual({ success: true, ids: ["p-1", "p-2", "p-3"] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("move_marketing_assets_bulk", {
      p_asset_ids: [ASSET_1, ASSET_2, ASSET_3],
      p_event_date: "2026-03-01",
      p_destination: "placed",
      p_region_id: REGION_ID,
      p_distributor_id: DISTRIBUTOR_ID,
      p_store_name: "Hotel Haris",
      p_store_address: "Jl. Merdeka 1",
      p_pic_name: "Bu Rina",
      p_condition: null,
      p_notes: "Event Agustusan",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/monitoring-posm");
  });

  it("applies one condition to every unit and drops store data when moving back to the warehouse", async () => {
    const client = setupMocks();
    await moveMarketingAssetsBulkAction(
      {},
      formDataOf({ ...toStore, destination: "warehouse", condition: "Rusak Ringan" })
    );

    expect(client.rpc).toHaveBeenCalledWith(
      "move_marketing_assets_bulk",
      expect.objectContaining({
        p_destination: "warehouse",
        p_region_id: null,
        p_distributor_id: null,
        p_store_name: null,
        p_store_address: null,
        p_condition: "Rusak Ringan",
      })
    );
  });

  it.each([
    ["no unit is selected", formDataOf(toStore, []), "Pilih minimal satu asset"],
    [
      "more than 100 units are selected",
      formDataOf(
        toStore,
        Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
      ),
      "Maksimal 100 asset sekali pindah",
    ],
    [
      "a placed move has no store",
      formDataOf({ ...toStore, store_name: "" }),
      "Nama toko harus diisi untuk asset yang ditempatkan",
    ],
    ["the condition is unknown", formDataOf({ ...toStore, condition: "Bagus" }), "Kondisi tidak valid"],
  ])("refuses without touching the database when %s", async (_case, formData, expected) => {
    const client = setupMocks();
    const result = await moveMarketingAssetsBulkAction({}, formData);
    expect(result).toEqual({ error: expected });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses users without POSM write access", async () => {
    const client = setupMocks({ department: "Finance" });
    const result = await moveMarketingAssetsBulkAction({}, formDataOf(toStore));
    expect(result).toEqual({ error: "Anda tidak memiliki akses." });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "PINDAH_DIHAPUSBUKUKAN: AST-0003",
      "Asset AST-0003 sudah Dihapusbukukan dan tidak bisa dipindahkan. Tidak ada asset yang dipindahkan.",
    ],
    [
      "PINDAH_TANGGAL_SEBELUM_PENDAFTARAN: AST-0001, AST-0002",
      "Tanggal perpindahan sebelum tanggal pendaftaran asset AST-0001, AST-0002. Tidak ada asset yang dipindahkan.",
    ],
    [
      "PINDAH_ASSET_TIDAK_DITEMUKAN: 1",
      "Sebagian asset sudah dihapus atau tidak ditemukan. Muat ulang halaman lalu coba lagi.",
    ],
  ])("explains why the whole move was refused (%s)", async (message, expected) => {
    setupMocks({ rpcError: { message, code: "P0001" } });
    const result = await moveMarketingAssetsBulkAction({}, formDataOf(toStore));
    expect(result).toEqual({ error: expected });
  });
});

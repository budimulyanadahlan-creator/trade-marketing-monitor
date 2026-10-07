import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteMarketingAssetAction, saveMarketingAssetAction } from "./posm";
import { createClient } from "@/lib/supabase/server";

type DbError = { message: string; code?: string } | null;

const REGION_ID = "44444444-4444-4444-8444-444444444444";
const DISTRIBUTOR_ID = "55555555-5555-4555-8555-555555555555";
const COOLER_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const RAK_TYPE_ID = "22222222-2222-4222-8222-222222222222";

type AssetTypeMock = { id: string; is_active: boolean } | null;

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  rpcError = null,
  placementCount = 1,
  updateError = null,
  assetType = { id: COOLER_TYPE_ID, is_active: true },
  currentTypeId = COOLER_TYPE_ID,
}: {
  role?: string;
  department?: string | null;
  rpcError?: DbError;
  placementCount?: number;
  updateError?: DbError;
  assetType?: AssetTypeMock;
  currentTypeId?: string;
} = {}) {
  const assetsIs = vi.fn().mockResolvedValue({ error: updateError });
  const assetsEq = vi.fn().mockReturnValue({ is: assetsIs });
  const currentAsset = vi.fn().mockResolvedValue({ data: { asset_type_id: currentTypeId } });
  const assets = {
    update: vi.fn().mockReturnValue({ eq: assetsEq }),
    select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: currentAsset }) }),
    eq: assetsEq,
    is: assetsIs,
  };
  const typeEq = vi.fn().mockReturnValue({
    is: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: assetType }) }),
  });
  const assetTypes = { select: vi.fn().mockReturnValue({ eq: typeEq }), eq: typeEq };
  const placementsEq = vi.fn().mockResolvedValue({ count: placementCount, error: null });
  const placements = { select: vi.fn().mockReturnValue({ eq: placementsEq }), eq: placementsEq };

  const client = {
    rpc: vi.fn().mockResolvedValue({ data: rpcError ? null : "asset-1", error: rpcError }),
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
      if (table === "marketing_assets") return assets;
      if (table === "asset_placements") return placements;
      if (table === "asset_types") return assetTypes;
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { ...client, assets, placements, assetTypes };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const validAsset = {
  code: "ast-0001",
  name: "Cooler Showcase 2 Pintu",
  asset_type_id: COOLER_TYPE_ID,
  acquisition_date: "2026-01-15",
  acquisition_value: "7500000",
  event_date: "2026-02-01",
  destination: "warehouse",
  condition: "Baik",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveMarketingAssetAction (new asset)", () => {
  it("registers the asset with its initial placement in the central warehouse in one RPC", async () => {
    const client = setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result.success).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("create_marketing_asset", {
      p_code: "AST-0001",
      p_name: "Cooler Showcase 2 Pintu",
      p_asset_type_id: COOLER_TYPE_ID,
      p_brand_id: null,
      p_serial_number: null,
      p_acquisition_date: "2026-01-15",
      p_acquisition_value: 7500000,
      p_event_date: "2026-02-01",
      p_destination: "warehouse",
      p_region_id: null,
      p_distributor_id: null,
      p_store_name: null,
      p_store_address: null,
      p_pic_name: null,
      p_condition: "Baik",
      p_notes: null,
    });
  });

  it("returns the new asset id from the RPC so its photo can be uploaded", async () => {
    setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result).toEqual({ success: true, id: "asset-1" });
  });
});

describe("saveMarketingAssetAction initial placement", () => {
  const placed = {
    ...validAsset,
    destination: "placed",
    region_id: REGION_ID,
    distributor_id: DISTRIBUTOR_ID,
    store_name: "Toko Maju Jaya",
    store_address: "Jl. Merdeka 10",
    pic_name: "Pak Budi",
  };

  it("stores the store location when the asset is placed directly", async () => {
    const client = setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf(placed));

    expect(result.success).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "create_marketing_asset",
      expect.objectContaining({
        p_destination: "placed",
        p_region_id: REGION_ID,
        p_distributor_id: DISTRIBUTOR_ID,
        p_store_name: "Toko Maju Jaya",
        p_store_address: "Jl. Merdeka 10",
        p_pic_name: "Pak Budi",
      })
    );
  });

  it("requires a region for a placed asset", async () => {
    const client = setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf({ ...placed, region_id: "" }));

    expect(result.error).toBe("Region harus diisi untuk asset yang ditempatkan");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires a store name for a placed asset", async () => {
    const client = setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf({ ...placed, store_name: " " }));

    expect(result.error).toBe("Nama toko harus diisi untuk asset yang ditempatkan");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("drops store details when the asset starts in the warehouse", async () => {
    const client = setupMocks();

    await saveMarketingAssetAction({}, formDataOf({ ...placed, destination: "warehouse" }));

    expect(client.rpc).toHaveBeenCalledWith(
      "create_marketing_asset",
      expect.objectContaining({ p_region_id: null, p_distributor_id: null, p_store_name: null, p_store_address: null })
    );
  });
});

describe("saveMarketingAssetAction asset type", () => {
  it("looks up the chosen type among non-deleted asset types", async () => {
    const client = setupMocks();

    await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(client.assetTypes.eq).toHaveBeenCalledWith("id", COOLER_TYPE_ID);
  });

  it("rejects a type that does not exist", async () => {
    const client = setupMocks({ assetType: null });

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result.error).toBe("Jenis asset tidak valid");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects an inactive type for a new asset", async () => {
    const client = setupMocks({ assetType: { id: COOLER_TYPE_ID, is_active: false } });

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result.error).toBe("Jenis asset sudah tidak aktif. Pilih jenis lain.");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a missing type id", async () => {
    const client = setupMocks();

    const result = await saveMarketingAssetAction({}, formDataOf({ ...validAsset, asset_type_id: "" }));

    expect(result.error).toBe("Jenis asset harus dipilih");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("saveMarketingAssetAction access and errors", () => {
  it("rejects a reader from a non-writer department", async () => {
    const client = setupMocks({ role: "manager", department: "Sales" });

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("explains a duplicate asset code", async () => {
    setupMocks({ rpcError: { message: "duplicate key value", code: "23505" } });

    const result = await saveMarketingAssetAction({}, formDataOf(validAsset));

    expect(result.error).toBe("Kode AST-0001 sudah dipakai asset lain. Gunakan kode lain.");
  });
});

describe("saveMarketingAssetAction (edit)", () => {
  const ASSET_ID = "77777777-7777-4777-8777-777777777777";

  const editForm = {
    id: ASSET_ID,
    code: "ast-0009",
    name: "Rak Display Besi",
    asset_type_id: RAK_TYPE_ID,
    acquisition_date: "2025-12-01",
    acquisition_value: "1200000",
  };

  it("updates only the master data of a non-deleted asset", async () => {
    const client = setupMocks({ assetType: { id: RAK_TYPE_ID, is_active: true } });

    const result = await saveMarketingAssetAction(
      {},
      formDataOf({
        id: ASSET_ID,
        code: "ast-0009",
        name: "Rak Display Besi",
        asset_type_id: RAK_TYPE_ID,
        serial_number: "SN-123",
        acquisition_date: "2025-12-01",
        acquisition_value: "1200000",
      })
    );

    expect(result.success).toBe(true);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.assets.update).toHaveBeenCalledWith({
      code: "AST-0009",
      name: "Rak Display Besi",
      asset_type_id: RAK_TYPE_ID,
      brand_id: null,
      serial_number: "SN-123",
      acquisition_date: "2025-12-01",
      acquisition_value: 1200000,
    });
    expect(client.assets.eq).toHaveBeenCalledWith("id", ASSET_ID);
    expect(client.assets.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("keeps an inactive type the asset already uses", async () => {
    const client = setupMocks({ assetType: { id: RAK_TYPE_ID, is_active: false }, currentTypeId: RAK_TYPE_ID });

    const result = await saveMarketingAssetAction({}, formDataOf(editForm));

    expect(result.success).toBe(true);
    expect(client.assets.update).toHaveBeenCalled();
  });

  it("refuses switching an asset to an inactive type", async () => {
    const client = setupMocks({ assetType: { id: RAK_TYPE_ID, is_active: false }, currentTypeId: COOLER_TYPE_ID });

    const result = await saveMarketingAssetAction({}, formDataOf(editForm));

    expect(result.error).toBe("Jenis asset sudah tidak aktif. Pilih jenis lain.");
    expect(client.assets.update).not.toHaveBeenCalled();
  });
});

describe("deleteMarketingAssetAction", () => {
  const ASSET_ID = "77777777-7777-4777-8777-777777777777";
  const HAS_HISTORY =
    "Asset sudah punya riwayat penempatan dan tidak bisa dihapus. Beri kondisi Dihapusbukukan saja.";

  it("soft-deletes an asset that only has its registration placement", async () => {
    const client = setupMocks({ placementCount: 1 });

    const result = await deleteMarketingAssetAction(ASSET_ID);

    expect(result.error).toBeUndefined();
    expect(client.placements.eq).toHaveBeenCalledWith("asset_id", ASSET_ID);
    expect(client.assets.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(client.assets.eq).toHaveBeenCalledWith("id", ASSET_ID);
    expect(client.assets.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("refuses an asset with a placement history", async () => {
    const client = setupMocks({ placementCount: 2 });

    const result = await deleteMarketingAssetAction(ASSET_ID);

    expect(result.error).toBe(HAS_HISTORY);
    expect(client.assets.update).not.toHaveBeenCalled();
  });

  it("explains the database guard when history appeared meanwhile", async () => {
    setupMocks({ updateError: { message: "ASSET_PUNYA_RIWAYAT: asset sudah punya riwayat penempatan" } });

    const result = await deleteMarketingAssetAction(ASSET_ID);

    expect(result.error).toBe(HAS_HISTORY);
  });

  it("rejects a non-writer", async () => {
    const client = setupMocks({ role: "finance", department: "Finance" });

    const result = await deleteMarketingAssetAction(ASSET_ID);

    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(client.assets.update).not.toHaveBeenCalled();
  });
});

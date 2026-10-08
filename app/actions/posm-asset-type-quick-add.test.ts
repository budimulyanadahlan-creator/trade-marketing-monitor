import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { quickAddAssetTypeAction } from "./posm";
import { createClient } from "@/lib/supabase/server";

type DbError = { message: string; code?: string } | null;
type TypeRow = { id: string; name: string; is_active: boolean };

const NEW_ID = "77777777-7777-4777-8777-777777777777";

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  existing = [],
  insertError = null,
}: {
  role?: string;
  department?: string | null;
  existing?: TypeRow[];
  insertError?: DbError;
} = {}) {
  const single = vi.fn().mockResolvedValue(
    insertError
      ? { data: null, error: insertError }
      : { data: { id: NEW_ID, name: "Seragam SPG", is_active: true }, error: null }
  );
  const insertSelect = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: insertSelect });
  const listIs = vi.fn().mockResolvedValue({ data: existing, error: null });
  const assetTypes = {
    select: vi.fn().mockReturnValue({ is: listIs }),
    insert,
  };

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
      if (table === "asset_types") return assetTypes;
      return {};
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { insert, listIs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("quickAddAssetTypeAction", () => {
  it("inserts a new asset type with a trimmed name and returns it", async () => {
    const { insert } = setupMocks();
    const result = await quickAddAssetTypeAction("  Seragam SPG  ");
    expect(insert).toHaveBeenCalledWith({ name: "Seragam SPG" });
    expect(result).toEqual({ type: { id: NEW_ID, name: "Seragam SPG", is_active: true } });
  });

  it("rejects a name matching an active type (case-insensitive) and suggests it", async () => {
    const existing = { id: "t-1", name: "Seragam/Pakaian", is_active: true };
    const { insert } = setupMocks({ existing: [existing] });
    const result = await quickAddAssetTypeAction("seragam/PAKAIAN");
    expect(insert).not.toHaveBeenCalled();
    expect(result.error).toContain("sudah ada");
    expect(result.existing).toEqual(existing);
  });

  it("rejects a name matching an inactive type and points to admin", async () => {
    const { insert } = setupMocks({
      existing: [{ id: "t-2", name: "Gondola", is_active: false }],
    });
    const result = await quickAddAssetTypeAction("gondola");
    expect(insert).not.toHaveBeenCalled();
    expect(result.error).toContain("Hubungi admin");
    expect(result.existing).toBeUndefined();
  });

  it("rejects an empty name", async () => {
    const { insert } = setupMocks();
    const result = await quickAddAssetTypeAction("   ");
    expect(result.error).toBe("Nama jenis asset harus diisi");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects users without POSM write access", async () => {
    const { insert } = setupMocks({ role: "user", department: "Finance" });
    const result = await quickAddAssetTypeAction("Seragam SPG");
    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps a unique violation from a concurrent insert to a duplicate message", async () => {
    setupMocks({ insertError: { code: "23505", message: "duplicate key" } });
    const result = await quickAddAssetTypeAction("Seragam SPG");
    expect(result.error).toBe('Jenis "Seragam SPG" sudah ada.');
  });
});

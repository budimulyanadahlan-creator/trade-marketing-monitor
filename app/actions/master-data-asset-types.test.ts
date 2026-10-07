import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  saveAssetTypeAction,
  toggleAssetTypeActiveAction,
  deleteAssetTypeAction,
} from "./master-data";
import { createClient } from "@/lib/supabase/server";

type DbError = { code?: string; message: string } | null;

function setupMocks({
  role = "admin",
  insertError = null,
  updateError = null,
}: { role?: string; insertError?: DbError; updateError?: DbError } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role, is_active: true } }),
        };
      }
      if (table === "asset_types") return { insert, update };
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  return { insert, update, updateEq };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const TYPE_ID = "6f1c2a8e-4b7d-4c2a-9f1e-1a2b3c4d5e6f";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveAssetTypeAction", () => {
  it("inserts a new asset type with a trimmed name", async () => {
    const { insert } = setupMocks();
    const result = await saveAssetTypeAction({}, formDataOf({ name: "  Seragam SPG  " }));
    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalledWith({ name: "Seragam SPG" });
  });

  it("renames an existing asset type", async () => {
    const { update, updateEq, insert } = setupMocks();
    const result = await saveAssetTypeAction({}, formDataOf({ id: TYPE_ID, name: "Kulkas" }));
    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith({ name: "Kulkas" });
    expect(updateEq).toHaveBeenCalledWith("id", TYPE_ID);
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    const { insert } = setupMocks();
    const result = await saveAssetTypeAction({}, formDataOf({ name: "   " }));
    expect(result.error).toBe("Nama jenis asset harus diisi");
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps the case-insensitive unique violation to a clear message", async () => {
    setupMocks({ insertError: { code: "23505", message: "duplicate key value violates unique constraint" } });
    const result = await saveAssetTypeAction({}, formDataOf({ name: "gondola" }));
    expect(result.error).toBe("Jenis asset dengan nama ini sudah ada (termasuk yang nonaktif).");
  });

  it("refuses non-admin users", async () => {
    const { insert } = setupMocks({ role: "marketing" });
    const result = await saveAssetTypeAction({}, formDataOf({ name: "Kulkas" }));
    expect(result.error).toBe("Anda tidak memiliki akses.");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("toggleAssetTypeActiveAction", () => {
  it("updates is_active for the given type", async () => {
    const { update, updateEq } = setupMocks();
    const result = await toggleAssetTypeActiveAction(TYPE_ID, false);
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: false });
    expect(updateEq).toHaveBeenCalledWith("id", TYPE_ID);
  });
});

describe("deleteAssetTypeAction", () => {
  it("soft deletes the type", async () => {
    const { update, updateEq } = setupMocks();
    const result = await deleteAssetTypeAction(TYPE_ID);
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(updateEq).toHaveBeenCalledWith("id", TYPE_ID);
  });

  it("explains that a type in use can only be deactivated", async () => {
    setupMocks({
      updateError: { code: "P0001", message: "JENIS_ASSET_DIPAKAI: jenis asset sudah dipakai asset" },
    });
    const result = await deleteAssetTypeAction(TYPE_ID);
    expect(result.error).toBe(
      "Jenis asset ini sudah dipakai asset sehingga tidak bisa dihapus. Nonaktifkan saja agar tidak muncul di form."
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/image-compress", () => ({
  compressImageIfNeeded: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { DELETE, POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { compressImageIfNeeded } from "@/lib/image-compress";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

type DbError = { message: string } | null;
type PhotoRecord = { id: string; photo_path: string | null; type?: string };
const RECORD_ID = "11111111-1111-4111-8111-111111111111";

// Query builder berantai: select() diakhiri maybeSingle() (baca record),
// update() di-await (hasil tulis).
function recordTable(record: PhotoRecord | null, updateError: DbError) {
  const t: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const m of ["select", "eq", "is"]) t[m] = vi.fn(() => t);
  t.update = vi.fn(() => t);
  t.maybeSingle = vi.fn(() => Promise.resolve({ data: record, error: null }));
  t.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ error: updateError }).then(resolve, reject);
  return t;
}

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  isActive = true,
  record = { id: RECORD_ID, photo_path: "item/old/1.jpg" } as PhotoRecord | null,
  uploadError = null as DbError,
  updateError = null as DbError,
  compressedSize = 1000,
} = {}) {
  const table = recordTable(record, updateError);
  const upload = vi.fn().mockResolvedValue({ error: uploadError });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const storageFrom = vi.fn().mockReturnValue({ upload, remove });

  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: vi.fn().mockImplementation((name: string) => {
      if (name === "users")
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role, is_active: isActive, department: department ? { name: department } : null },
          }),
        };
      return table;
    }),
    storage: { from: storageFrom },
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  (compressImageIfNeeded as ReturnType<typeof vi.fn>).mockResolvedValue({
    buffer: Buffer.alloc(compressedSize),
    contentType: "image/jpeg",
  });

  return { supabase, table, upload, remove, storageFrom };
}

function makeFile({ type = "image/png", size = 2000 } = {}) {
  return { name: "foto.png", type, size, arrayBuffer: async () => new ArrayBuffer(size) };
}

// Route hanya memanggil request.formData(), jadi cukup objek palsu minimal.
function postRequest(entries: Record<string, unknown>) {
  return {
    formData: async () => ({ get: (key: string) => entries[key] ?? null }),
  } as unknown as NextRequest;
}

function deleteRequest(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/posm-photo", () => {
  it("uploads a new item photo, saves its path, and removes the old file", async () => {
    const { supabase, table, upload, remove, storageFrom } = setupMocks();

    const res = await POST(postRequest({ kind: "item", id: RECORD_ID, file: makeFile() }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("posm_items");
    expect(storageFrom).toHaveBeenCalledWith("posm-photos");
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^item/${RECORD_ID}/\\d+\\.jpg$`));
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(table.update).toHaveBeenCalledWith({ photo_path: path });
    expect(remove).toHaveBeenCalledWith(["item/old/1.jpg"]);
    expect(json.photo_path).toBe(path);
  });

  it("rejects users outside Marketing / Trade Marketing without touching storage", async () => {
    const { upload, table } = setupMocks({ department: "Sales" });

    const res = await POST(postRequest({ kind: "item", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it("rejects distributors even from a Marketing department", async () => {
    const { upload } = setupMocks({ role: "distributor", department: "Marketing" });

    const res = await POST(postRequest({ kind: "item", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects non-image files with a clear message", async () => {
    const { upload } = setupMocks();

    const res = await POST(
      postRequest({ kind: "asset", id: RECORD_ID, file: makeFile({ type: "application/pdf" }) })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/JPG atau PNG/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects files over 4.4 MB", async () => {
    const { upload } = setupMocks();

    const res = await POST(
      postRequest({ kind: "asset", id: RECORD_ID, file: makeFile({ size: 4_400_001 }) })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/4,4 MB/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects unknown photo kinds", async () => {
    const { upload } = setupMocks();

    const res = await POST(postRequest({ kind: "users", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or deleted record", async () => {
    const { upload } = setupMocks({ record: null });

    const res = await POST(postRequest({ kind: "placement", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
  });

  it("stores placement photos on asset_placements and skips removal when there was no old photo", async () => {
    const { supabase, remove } = setupMocks({ record: { id: RECORD_ID, photo_path: null } });

    const res = await POST(postRequest({ kind: "placement", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("asset_placements");
    expect(remove).not.toHaveBeenCalled();
  });

  it("stores gimmick item photos in the separate gimmick-photos bucket", async () => {
    const { supabase, upload, remove, storageFrom } = setupMocks({
      record: { id: RECORD_ID, photo_path: "gimmick_item/old/1.jpg" },
    });

    const res = await POST(postRequest({ kind: "gimmick_item", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("gimmick_items");
    expect(storageFrom).toHaveBeenCalledWith("gimmick-photos");
    expect(storageFrom).not.toHaveBeenCalledWith("posm-photos");
    expect(upload.mock.calls[0][0]).toMatch(new RegExp(`^gimmick_item/${RECORD_ID}/\\d+\\.jpg$`));
    expect(remove).toHaveBeenCalledWith(["gimmick_item/old/1.jpg"]);
  });

  it("stores handover proof photos on Keluar gimmick movements", async () => {
    const { supabase, storageFrom } = setupMocks({ record: { id: RECORD_ID, photo_path: null, type: "out" } });

    const res = await POST(postRequest({ kind: "gimmick_movement", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("gimmick_movements");
    expect(storageFrom).toHaveBeenCalledWith("gimmick-photos");
  });

  it("rejects proof photos on gimmick movements other than Keluar", async () => {
    const { upload, table } = setupMocks({ record: { id: RECORD_ID, photo_path: null, type: "in" } });

    const res = await POST(postRequest({ kind: "gimmick_movement", id: RECORD_ID, file: makeFile() }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Keluar/);
    expect(upload).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it("removes the new upload and keeps the old photo when saving the path fails", async () => {
    const { upload, remove } = setupMocks({ updateError: { message: "permission denied" } });

    const res = await POST(postRequest({ kind: "item", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(500);
    const path = upload.mock.calls[0][0];
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it("does not update the record when the storage upload is rejected", async () => {
    const { table } = setupMocks({ uploadError: { message: "new row violates row-level security policy" } });

    const res = await POST(postRequest({ kind: "item", id: RECORD_ID, file: makeFile() }));

    expect(res.status).toBe(500);
    expect(table.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/posm-photo", () => {
  it("clears the photo path and removes the file from storage", async () => {
    const { supabase, table, remove } = setupMocks({ record: { id: RECORD_ID, photo_path: "asset/a/1.jpg" } });

    const res = await DELETE(deleteRequest({ kind: "asset", id: RECORD_ID }));

    expect(res.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("marketing_assets");
    expect(table.update).toHaveBeenCalledWith({ photo_path: null });
    expect(remove).toHaveBeenCalledWith(["asset/a/1.jpg"]);
  });

  it("keeps the file when clearing the path fails", async () => {
    const { remove } = setupMocks({ updateError: { message: "boom" } });

    const res = await DELETE(deleteRequest({ kind: "item", id: RECORD_ID }));

    expect(res.status).toBe(500);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects non-writers", async () => {
    const { table, remove } = setupMocks({ role: "finance", department: "Finance" });

    const res = await DELETE(deleteRequest({ kind: "item", id: RECORD_ID }));

    expect(res.status).toBe(403);
    expect(table.update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

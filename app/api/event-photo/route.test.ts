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
type PhotoRecord = { id: string; event_id: string; path: string };
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";

// Query builder berantai: maybeSingle() untuk baca satu baris, await
// langsung untuk count/insert/update (hasil `awaited`).
function table({ single = null as unknown, awaited = {} as Record<string, unknown> } = {}) {
  const t: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const m of ["select", "eq", "is", "insert", "update"]) t[m] = vi.fn(() => t);
  t.maybeSingle = vi.fn(() => Promise.resolve({ data: single, error: null }));
  t.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(awaited).then(resolve, reject);
  return t;
}

function setupMocks({
  role = "user",
  department = "Trade Marketing",
  event = { id: EVENT_ID } as { id: string } | null,
  photoCount = 0,
  photo = { id: PHOTO_ID, event_id: EVENT_ID, path: `${EVENT_ID}/1.jpg` } as PhotoRecord | null,
  uploadError = null as DbError,
  writeError = null as DbError,
  compressedSize = 1000,
} = {}) {
  const events = table({ single: event });
  const photos = table({ single: photo, awaited: { count: photoCount, error: writeError } });
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
            data: { role, is_active: true, department: department ? { name: department } : null },
          }),
        };
      return name === "events" ? events : photos;
    }),
    storage: { from: storageFrom },
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  (compressImageIfNeeded as ReturnType<typeof vi.fn>).mockResolvedValue({
    buffer: Buffer.alloc(compressedSize),
    contentType: "image/jpeg",
  });

  return { supabase, photos, upload, remove, storageFrom };
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

describe("POST /api/event-photo", () => {
  it("uploads to the event-photos bucket under the event folder and records the photo", async () => {
    const { photos, upload, storageFrom } = setupMocks({ photoCount: 3 });

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(storageFrom).toHaveBeenCalledWith("event-photos");
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^${EVENT_ID}/\\d+\\.jpg$`));
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(photos.insert).toHaveBeenCalledWith({ event_id: EVENT_ID, path });
    expect(json.path).toBe(path);
  });
});

describe("POST /api/event-photo — penolakan", () => {
  it("rejects the 11th photo with a clear message before uploading", async () => {
    const { upload, photos } = setupMocks({ photoCount: 10 });

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Maksimal 10 foto/);
    expect(upload).not.toHaveBeenCalled();
    expect(photos.insert).not.toHaveBeenCalled();
  });

  it("removes the upload and explains the limit when the database trigger rejects it", async () => {
    const { upload, remove } = setupMocks({
      photoCount: 9,
      writeError: { message: "FOTO_MAKSIMAL: maksimal 10 foto per event" },
    });

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Maksimal 10 foto/);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  it("rejects files over 4.4 MB", async () => {
    const { upload } = setupMocks();

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile({ size: 4_400_001 }) }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/4,4 MB/);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects non-image files", async () => {
    const { upload } = setupMocks();

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile({ type: "application/pdf" }) }));

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["Sales user", { role: "user", department: "Sales" }],
    ["finance", { role: "finance", department: "Finance" }],
    ["distributor", { role: "distributor", department: "Marketing" }],
  ])("rejects %s without touching storage", async (_, who) => {
    const { upload, photos } = setupMocks(who);

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));

    expect(res.status).toBe(403);
    expect(upload).not.toHaveBeenCalled();
    expect(photos.insert).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or deleted event", async () => {
    const { upload } = setupMocks({ event: null });

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));

    expect(res.status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an invalid event id", async () => {
    const { upload } = setupMocks();

    const res = await POST(postRequest({ event_id: "../other", file: makeFile() }));

    expect(res.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not record the photo when the storage upload is rejected", async () => {
    const { photos } = setupMocks({ uploadError: { message: "new row violates row-level security policy" } });

    const res = await POST(postRequest({ event_id: EVENT_ID, file: makeFile() }));

    expect(res.status).toBe(500);
    expect(photos.insert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/event-photo", () => {
  it("soft deletes the photo row and removes the storage object", async () => {
    const { photos, remove, storageFrom } = setupMocks();

    const res = await DELETE(deleteRequest({ id: PHOTO_ID }));

    expect(res.status).toBe(200);
    expect(photos.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(storageFrom).toHaveBeenCalledWith("event-photos");
    expect(remove).toHaveBeenCalledWith([`${EVENT_ID}/1.jpg`]);
  });

  it("keeps the file when the soft delete fails", async () => {
    const { remove } = setupMocks({ writeError: { message: "boom" } });

    const res = await DELETE(deleteRequest({ id: PHOTO_ID }));

    expect(res.status).toBe(500);
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing or already deleted photo", async () => {
    const { photos } = setupMocks({ photo: null });

    const res = await DELETE(deleteRequest({ id: PHOTO_ID }));

    expect(res.status).toBe(404);
    expect(photos.update).not.toHaveBeenCalled();
  });

  it("rejects non-writers", async () => {
    const { photos, remove } = setupMocks({ role: "manager", department: "Sales" });

    const res = await DELETE(deleteRequest({ id: PHOTO_ID }));

    expect(res.status).toBe(403);
    expect(photos.update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

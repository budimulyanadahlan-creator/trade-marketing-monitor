import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/image-compress", () => ({
  compressImageIfNeeded: vi.fn(),
}));
vi.mock("@/lib/claim-checklist-sync", () => ({
  markChecklistFulfilled: vi.fn(),
}));

import { POST } from "./route";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { compressImageIfNeeded } from "@/lib/image-compress";
import { markChecklistFulfilled } from "@/lib/claim-checklist-sync";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeSelectChain(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeInsertChain(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function setupMocks(
  opts: Partial<{
    role: string;
    isActive: boolean;
    userDistributorId: string | null;
    campaign: { id: string; status: string; distributor_id?: string | null } | null;
    docType: { id: string } | null;
    insertedFile: unknown;
    insertError: { message: string } | null;
    uploadError: { message: string } | null;
  }> = {}
) {
  const {
    role = "distributor",
    isActive = true,
    userDistributorId = null,
    campaign = { id: "camp-1", status: "ongoing" },
    docType = { id: "doc-1" },
    insertedFile = { id: "file-1" },
    insertError = null,
    uploadError = null,
  } = opts;

  const usersChain = makeSelectChain({
    data: { role, is_active: isActive, distributor_id: userDistributorId },
  });
  const campaignsChain = makeSelectChain({ data: campaign });
  const docTypesChain = makeSelectChain({ data: docType });
  const filesInsertChain = makeInsertChain({ data: insertedFile, error: insertError });

  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "dist-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return usersChain;
      if (table === "campaigns") return campaignsChain;
      if (table === "claim_document_types") return docTypesChain;
      if (table === "campaign_files") return filesInsertChain;
      return makeSelectChain({ data: null });
    }),
  };

  const storageUpload = vi.fn().mockResolvedValue({ error: uploadError });
  const storageRemove = vi.fn().mockResolvedValue({});
  const adminClient = {
    storage: {
      from: vi.fn().mockReturnValue({ upload: storageUpload, remove: storageRemove }),
    },
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);
  (compressImageIfNeeded as ReturnType<typeof vi.fn>).mockResolvedValue({
    buffer: Buffer.from("compressed-bytes"),
    contentType: "image/jpeg",
  });
  (markChecklistFulfilled as ReturnType<typeof vi.fn>).mockResolvedValue({});

  return { supabase, adminClient, storageUpload, storageRemove, filesInsertChain };
}

// jsdom's File/FormData globals aren't the same classes Next's NextRequest
// expects internally (undici), so a real multipart body trips a brand check.
// Route logic only ever calls request.formData(), so a minimal fake with a
// duck-typed File-like value is enough and avoids that cross-realm mismatch.
function makeFakeFile(overrides: Partial<{ name: string; type: string; bytes: number[] }> = {}) {
  const bytes = overrides.bytes ?? [1, 2, 3];
  return {
    name: overrides.name ?? "photo.png",
    type: overrides.type ?? "image/png",
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

function makeRequest(
  overrides: Partial<{
    file: unknown;
    campaignId: string | null;
    documentTypeId: string | null;
  }> = {}
) {
  const entries = new Map<string, unknown>();
  const file = overrides.file === null ? null : overrides.file ?? makeFakeFile();
  if (file) entries.set("file", file);
  if (overrides.campaignId !== null) {
    entries.set("campaign_id", overrides.campaignId ?? "camp-1");
  }
  if (overrides.documentTypeId !== null) {
    entries.set("document_type_id", overrides.documentTypeId ?? "doc-1");
  }

  return {
    formData: async () => ({
      get: (key: string) => entries.get(key) ?? null,
    }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/upload/claim-document", () => {
  it("uploads a compressed file and marks the checklist item fulfilled", async () => {
    const { storageUpload } = setupMocks();

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.file).toEqual({ id: "file-1" });
    expect(storageUpload).toHaveBeenCalled();
    expect(markChecklistFulfilled).toHaveBeenCalledWith(
      expect.anything(),
      { campaignId: "camp-1", distributorId: "dist-1", documentTypeId: "doc-1" }
    );
  });

  it("rejects non-distributor roles", async () => {
    setupMocks({ role: "admin" });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/distributor/i);
  });

  it("rejects inactive users", async () => {
    setupMocks({ isActive: false });

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
  });

  it("rejects when campaign is not visible/found", async () => {
    setupMocks({ campaign: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
  });

  it("rejects a distributor uploading to a campaign assigned to a different distributor company", async () => {
    setupMocks({
      userDistributorId: "company-a",
      campaign: { id: "camp-1", status: "ongoing", distributor_id: "company-b" },
    });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/bukan milik/i);
  });

  it("allows an unmapped distributor account on a campaign with no distributor assigned yet", async () => {
    setupMocks({
      userDistributorId: null,
      campaign: { id: "camp-1", status: "ongoing", distributor_id: null },
    });

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
  });

  it("rejects when campaign status is not editable (e.g. draft)", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "draft" } });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Approved|Ongoing|Klaim Diajukan/i);
  });

  it("rejects claim_submitted — uploads are locked once a claim is submitted", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "claim_submitted" } });

    const res = await POST(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Approved|Ongoing/i);
  });

  it("rejects missing file", async () => {
    setupMocks();

    const res = await POST(makeRequest({ file: null }));

    expect(res.status).toBe(400);
  });

  it("rejects missing document_type_id", async () => {
    setupMocks();

    const res = await POST(makeRequest({ documentTypeId: null }));

    expect(res.status).toBe(400);
  });

  it("rejects unknown document type", async () => {
    setupMocks({ docType: null });

    const res = await POST(makeRequest());

    expect(res.status).toBe(400);
  });

  it("rejects unsupported file types", async () => {
    setupMocks();
    const file = makeFakeFile({ name: "doc.txt", type: "text/plain" });

    const res = await POST(makeRequest({ file }));

    expect(res.status).toBe(400);
  });

  it("cleans up the uploaded storage object when the DB insert fails", async () => {
    const { storageRemove } = setupMocks({ insertError: { message: "db fail" } });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(storageRemove).toHaveBeenCalled();
  });

  it("rejects when storage upload fails", async () => {
    setupMocks({ uploadError: { message: "storage fail" } });

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/claim-checklist-sync", () => ({
  syncChecklistAfterFileDelete: vi.fn(),
}));

import { DELETE } from "./route";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { syncChecklistAfterFileDelete } from "@/lib/claim-checklist-sync";

function makeSelectChain(result: { data: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function setupMocks(
  fileRecord: unknown,
  campaign: { status: string } | null = { status: "ongoing" }
) {
  const filesChain = makeSelectChain({ data: fileRecord });
  const campaignsChain = makeSelectChain({ data: campaign });
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "dist-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "campaign_files") return filesChain;
      if (table === "campaigns") return campaignsChain;
      return filesChain;
    }),
  };

  const storageRemove = vi.fn().mockResolvedValue({});
  const adminClient = { storage: { from: vi.fn().mockReturnValue({ remove: storageRemove }) } };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);
  (syncChecklistAfterFileDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

  return { supabase, filesChain, campaignsChain, storageRemove };
}

function makeRequest(fileId: string | null) {
  return {
    json: async () => ({ fileId }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/upload", () => {
  it("removes a claim document and syncs the checklist item afterwards", async () => {
    setupMocks({
      file_url: "path/to/file.jpg",
      uploaded_by: "dist-1",
      campaign_id: "camp-1",
      document_type_id: "doc-1",
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(syncChecklistAfterFileDelete).toHaveBeenCalledWith(expect.anything(), {
      campaignId: "camp-1",
      distributorId: "dist-1",
      documentTypeId: "doc-1",
    });
  });

  it("does not touch the checklist when deleting a plain SKP attachment (no document_type_id)", async () => {
    setupMocks({
      file_url: "path/to/file.pdf",
      uploaded_by: "dist-1",
      campaign_id: "camp-1",
      document_type_id: null,
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("rejects deleting a file uploaded by someone else", async () => {
    setupMocks({
      file_url: "path/to/file.jpg",
      uploaded_by: "someone-else",
      campaign_id: "camp-1",
      document_type_id: "doc-1",
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(404);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("rejects deleting a claim document once the claim has been submitted (locked)", async () => {
    setupMocks(
      {
        file_url: "path/to/file.jpg",
        uploaded_by: "dist-1",
        campaign_id: "camp-1",
        document_type_id: "doc-1",
      },
      { status: "claim_submitted" }
    );

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Approved|Ongoing/i);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("allows deleting a plain SKP attachment even when the campaign is claim_submitted", async () => {
    setupMocks(
      {
        file_url: "path/to/file.pdf",
        uploaded_by: "dist-1",
        campaign_id: "camp-1",
        document_type_id: null,
      },
      { status: "claim_submitted" }
    );

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
  });
});

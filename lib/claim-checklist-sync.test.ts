import { describe, it, expect, vi } from "vitest";
import {
  markChecklistFulfilled,
  syncChecklistAfterFileDelete,
} from "./claim-checklist-sync";

function makeThenableChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "update"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

describe("markChecklistFulfilled", () => {
  it("upserts one row per SKP + document type, recording the actor as last modifier", async () => {
    const chain = makeThenableChain({ error: null });
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    const result = await markChecklistFulfilled(supabase as never, {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(result.error).toBeUndefined();
    expect(supabase.from).toHaveBeenCalledWith("distributor_claim_checklists");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "camp-1",
        distributor_id: "dist-1",
        document_type_id: "doc-1",
        is_fulfilled: true,
      }),
      { onConflict: "campaign_id,document_type_id" }
    );
  });

  it("returns the error message when the upsert fails", async () => {
    const chain = makeThenableChain({ error: { message: "boom" } });
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    const result = await markChecklistFulfilled(supabase as never, {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(result.error).toBe("boom");
  });
});

describe("syncChecklistAfterFileDelete", () => {
  it("counts remaining files of that document type across ALL uploaders on the SKP", async () => {
    const filesChain = makeThenableChain({ count: 1 });
    const checklistChain = makeThenableChain({ error: null });
    const supabase = {
      from: vi.fn().mockImplementation((table: string) =>
        table === "campaign_files" ? filesChain : checklistChain
      ),
    };

    await syncChecklistAfterFileDelete(supabase as never, {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(filesChain.eq).toHaveBeenCalledWith("campaign_id", "camp-1");
    expect(filesChain.eq).toHaveBeenCalledWith("document_type_id", "doc-1");
    expect(filesChain.eq).not.toHaveBeenCalledWith("uploaded_by", expect.anything());
    // File milik rekan masih ada → centang tetap.
    expect(checklistChain.update).not.toHaveBeenCalled();
  });

  it("resets the SKP's checklist item when no files remain, recording the actor", async () => {
    const filesChain = makeThenableChain({ count: 0 });
    const checklistChain = makeThenableChain({ error: null });
    const supabase = {
      from: vi.fn().mockImplementation((table: string) =>
        table === "campaign_files" ? filesChain : checklistChain
      ),
    };

    await syncChecklistAfterFileDelete(supabase as never, {
      campaignId: "camp-1",
      actorId: "dist-2",
      documentTypeId: "doc-1",
    });

    expect(checklistChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_fulfilled: false, distributor_id: "dist-2" })
    );
    expect(checklistChain.eq).toHaveBeenCalledWith("campaign_id", "camp-1");
    expect(checklistChain.eq).toHaveBeenCalledWith("document_type_id", "doc-1");
    expect(checklistChain.eq).not.toHaveBeenCalledWith("distributor_id", expect.anything());
  });
});

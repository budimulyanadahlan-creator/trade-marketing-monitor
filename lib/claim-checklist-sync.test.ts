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
  it("upserts is_fulfilled=true for the campaign/distributor/document combo", async () => {
    const chain = makeThenableChain({ error: null });
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    const result = await markChecklistFulfilled(supabase as never, {
      campaignId: "camp-1",
      distributorId: "dist-1",
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
      { onConflict: "campaign_id,distributor_id,document_type_id" }
    );
  });

  it("returns the error message when the upsert fails", async () => {
    const chain = makeThenableChain({ error: { message: "boom" } });
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    const result = await markChecklistFulfilled(supabase as never, {
      campaignId: "camp-1",
      distributorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(result.error).toBe("boom");
  });
});

describe("syncChecklistAfterFileDelete", () => {
  it("resets is_fulfilled to false when no files remain for the item", async () => {
    const filesChain = makeThenableChain({ count: 0 });
    const checklistChain = makeThenableChain({ error: null });
    const supabase = {
      from: vi.fn().mockImplementation((table: string) =>
        table === "campaign_files" ? filesChain : checklistChain
      ),
    };

    await syncChecklistAfterFileDelete(supabase as never, {
      campaignId: "camp-1",
      distributorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(checklistChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_fulfilled: false })
    );
  });

  it("leaves is_fulfilled untouched when other files still remain for the item", async () => {
    const filesChain = makeThenableChain({ count: 2 });
    const checklistChain = makeThenableChain({ error: null });
    const supabase = {
      from: vi.fn().mockImplementation((table: string) =>
        table === "campaign_files" ? filesChain : checklistChain
      ),
    };

    await syncChecklistAfterFileDelete(supabase as never, {
      campaignId: "camp-1",
      distributorId: "dist-1",
      documentTypeId: "doc-1",
    });

    expect(checklistChain.update).not.toHaveBeenCalled();
  });
});

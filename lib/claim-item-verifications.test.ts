import { describe, it, expect, vi } from "vitest";
import {
  ensureClaimItemVerifications,
  resetClaimItemToPending,
  resetAllClaimItemVerifications,
} from "./claim-item-verifications";

function makeThenableChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
}

function setup({
  existing = [] as { item_type: string; document_type_id: string | null }[],
  requirements = [] as { document_type_id: string }[],
}: {
  existing?: { item_type: string; document_type_id: string | null }[];
  requirements?: { document_type_id: string }[];
} = {}) {
  const itemsChain = makeThenableChain({ data: existing });
  const requirementsChain = makeThenableChain({ data: requirements });
  const insertChain = makeThenableChain({ error: null });

  // The same "claim_item_verifications" table is read (existing items) and
  // then, if needed, written to (insert) — the select chain must resolve
  // for `await`, and .insert() must return a separate resolvable chain.
  const itemsTable = { ...itemsChain, insert: insertChain.insert };

  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "claim_item_verifications") return itemsTable;
      if (table === "claim_requirements") return requirementsChain;
      return itemsChain;
    }),
  };

  return { supabase, itemsTable, insertChain };
}

describe("ensureClaimItemVerifications", () => {
  it("creates one pending item per required document plus the amount item when none exist", async () => {
    const { supabase, insertChain } = setup({
      requirements: [{ document_type_id: "doc-1" }, { document_type_id: "doc-2" }],
    });

    await ensureClaimItemVerifications(supabase as never, "camp-1", "cat-1");

    expect(insertChain.insert).toHaveBeenCalledWith([
      { campaign_id: "camp-1", item_type: "document", document_type_id: "doc-1", status: "pending" },
      { campaign_id: "camp-1", item_type: "document", document_type_id: "doc-2", status: "pending" },
      { campaign_id: "camp-1", item_type: "amount", document_type_id: null, status: "pending" },
    ]);
  });

  it("skips claim_requirements entirely when the campaign has no promotion category", async () => {
    const { supabase, insertChain } = setup();

    await ensureClaimItemVerifications(supabase as never, "camp-1", null);

    expect(supabase.from).not.toHaveBeenCalledWith("claim_requirements");
    expect(insertChain.insert).toHaveBeenCalledWith([
      { campaign_id: "camp-1", item_type: "amount", document_type_id: null, status: "pending" },
    ]);
  });

  it("does not insert anything when every item already exists", async () => {
    const { insertChain, supabase } = setup({
      existing: [
        { item_type: "document", document_type_id: "doc-1" },
        { item_type: "amount", document_type_id: null },
      ],
      requirements: [{ document_type_id: "doc-1" }],
    });

    await ensureClaimItemVerifications(supabase as never, "camp-1", "cat-1");

    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it("only inserts the missing items, leaving already-decided ones untouched", async () => {
    const { insertChain, supabase } = setup({
      existing: [{ item_type: "document", document_type_id: "doc-1" }],
      requirements: [{ document_type_id: "doc-1" }, { document_type_id: "doc-2" }],
    });

    await ensureClaimItemVerifications(supabase as never, "camp-1", "cat-1");

    expect(insertChain.insert).toHaveBeenCalledWith([
      { campaign_id: "camp-1", item_type: "document", document_type_id: "doc-2", status: "pending" },
      { campaign_id: "camp-1", item_type: "amount", document_type_id: null, status: "pending" },
    ]);
  });
});

// -------------------------------------------------------
// resetClaimItemToPending (Phase 3 — distributor fixes a revision)
// -------------------------------------------------------

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["update", "eq", "is"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
  return chain;
}

describe("resetClaimItemToPending", () => {
  it("resets a document item back to pending, scoped to its document_type_id", async () => {
    const chain = makeUpdateChain();
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    await resetClaimItemToPending(supabase as never, "camp-1", {
      itemType: "document",
      documentTypeId: "doc-1",
    });

    expect(supabase.from).toHaveBeenCalledWith("claim_item_verifications");
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        note: null,
        actor_id: null,
        decided_at: null,
      })
    );
    expect(chain.eq).toHaveBeenCalledWith("campaign_id", "camp-1");
    expect(chain.eq).toHaveBeenCalledWith("item_type", "document");
    expect(chain.eq).toHaveBeenCalledWith("document_type_id", "doc-1");
    expect(chain.eq).toHaveBeenCalledWith("status", "revision_requested");
  });

  it("resets the amount item back to pending, scoped by a null document_type_id", async () => {
    const chain = makeUpdateChain();
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    await resetClaimItemToPending(supabase as never, "camp-1", { itemType: "amount" });

    expect(chain.eq).toHaveBeenCalledWith("item_type", "amount");
    expect(chain.is).toHaveBeenCalledWith("document_type_id", null);
  });
});

// -------------------------------------------------------
// resetAllClaimItemVerifications (Phase 3 — cancel klaim / new claim cycle)
// -------------------------------------------------------

describe("resetAllClaimItemVerifications", () => {
  it("deletes every claim_item_verifications row for the campaign", async () => {
    const chain: Record<string, unknown> = {};
    chain.delete = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.then = (resolve: (v: unknown) => void) => resolve({ error: null });
    const supabase = { from: vi.fn().mockReturnValue(chain) };

    await resetAllClaimItemVerifications(supabase as never, "camp-1");

    expect(supabase.from).toHaveBeenCalledWith("claim_item_verifications");
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith("campaign_id", "camp-1");
  });
});

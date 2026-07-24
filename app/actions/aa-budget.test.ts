import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { checkAABudgetExceededAction } from "./aa-budget";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

interface CampaignRow {
  id: string;
  requested_budget: number | null;
  status: string;
}

function makeAAChain(aa: { target_budget: number } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: aa, error: aa ? null : { message: "not found" } }),
  };
}

// Thenable chain that actually applies .in / .neq filters to the rows,
// so tests exercise behavior instead of asserting on call arguments.
function makeCampaignsChain(rows: CampaignRow[]) {
  let filtered = [...rows];
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn((_col: string, statuses: string[]) => {
      filtered = filtered.filter((r) => statuses.includes(r.status));
      return chain;
    }),
    neq: vi.fn((_col: string, id: string) => {
      filtered = filtered.filter((r) => r.id !== id);
      return chain;
    }),
    then(resolve: (v: { data: CampaignRow[]; error: null }) => void) {
      resolve({ data: filtered, error: null });
    },
  };
  return chain;
}

function setupMocks({
  user = { id: "user-1" } as { id: string } | null,
  targetBudget = 1000,
  campaigns = [] as CampaignRow[],
  aaExists = true,
} = {}) {
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  });

  const adminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "action_approvals")
        return makeAAChain(aaExists ? { target_budget: targetBudget } : null);
      if (table === "campaigns") return makeCampaignsChain(campaigns);
      return {};
    }),
  };
  (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);

  return { adminClient };
}

const aaId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkAABudgetExceededAction", () => {
  it("exceeded=true saat requested budget melebihi target dikurangi total komitmen", async () => {
    setupMocks({
      targetBudget: 1000,
      campaigns: [
        { id: "c1", requested_budget: 600, status: "approved_l1" },
        { id: "c2", requested_budget: 300, status: "paid" },
      ],
    });

    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 101,
    });

    expect(result.exceeded).toBe(true);
  });

  it("exceeded=false saat requested budget masih dalam sisa (tepat sama = tidak melebihi)", async () => {
    setupMocks({
      targetBudget: 1000,
      campaigns: [{ id: "c1", requested_budget: 600, status: "approved_l1" }],
    });

    const within = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 300,
    });
    expect(within.exceeded).toBe(false);

    setupMocks({
      targetBudget: 1000,
      campaigns: [{ id: "c1", requested_budget: 600, status: "approved_l1" }],
    });
    const exact = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 400,
    });
    expect(exact.exceeded).toBe(false);
  });

  it("campaign non-komitmen (rejected/draft/submitted/cancelled) tidak ikut memotong", async () => {
    setupMocks({
      targetBudget: 1000,
      campaigns: [
        { id: "c1", requested_budget: 900, status: "rejected" },
        { id: "c2", requested_budget: 900, status: "draft" },
        { id: "c3", requested_budget: 900, status: "submitted" },
        { id: "c4", requested_budget: 900, status: "cancelled" },
        { id: "c5", requested_budget: 100, status: "approved" },
      ],
    });

    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 900,
    });

    expect(result.exceeded).toBe(false);
  });

  it("saat edit, nilai campaign itu sendiri dikeluarkan dari total komitmen", async () => {
    setupMocks({
      targetBudget: 1000,
      campaigns: [
        { id: campaignId, requested_budget: 800, status: "approved_l2" },
        { id: "c-other", requested_budget: 100, status: "approved" },
      ],
    });

    // Tanpa pengecualian, komitmen 900 → 800 akan dianggap melebihi sisa 100.
    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 800,
      campaign_id: campaignId,
    });

    expect(result.exceeded).toBe(false);
  });

  it("respons hanya berisi boolean exceeded — tidak ada angka sisa yang bocor", async () => {
    setupMocks({
      targetBudget: 1000,
      campaigns: [{ id: "c1", requested_budget: 600, status: "approved_l1" }],
    });

    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 500,
    });

    expect(Object.keys(result)).toEqual(["exceeded"]);
    expect(typeof result.exceeded).toBe("boolean");
  });

  it("user tidak login → exceeded=false tanpa menyentuh data", async () => {
    const { adminClient } = setupMocks({ user: null });

    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 999999,
    });

    expect(result).toEqual({ exceeded: false });
    expect(adminClient.from).not.toHaveBeenCalled();
  });

  it("AA tidak ditemukan → exceeded=false", async () => {
    setupMocks({ aaExists: false });

    const result = await checkAABudgetExceededAction({
      action_approval_id: aaId,
      requested_budget: 999999,
    });

    expect(result).toEqual({ exceeded: false });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendClaimSubmittedEmail: vi.fn() }));

import { submitKlaimAction, cancelKlaimAction } from "./realizations";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendClaimSubmittedEmail } from "@/lib/email";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeQueryChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data }),
  };
}

// Supports both the select().eq().single() read and the update().eq() write
// submitKlaimAction issues against the same "campaigns" table.
function makeCampaignsChain(
  campaign: unknown,
  updateError: { message: string } | null = null
) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: campaign }),
    error: updateError,
  });
  return chain;
}

// Serves both admin-client "users" queries submitKlaimAction's notification
// step makes: the finance-list read (select().eq().eq(), no .single()) and
// the creator-profile read (select().eq().single()).
function makeUsersAdminChain(
  financeUsers: { id: string; full_name: string }[],
  creatorProfile: { id: string; full_name: string } | null
) {
  const chain: Record<string, unknown> = { data: financeUsers };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: creatorProfile });
  return chain;
}

type SetupOptions = {
  userId?: string | null;
  role?: string;
  isActive?: boolean;
  campaign?:
    | { id: string; status: string; name: string; created_by: string }
    | null;
  updateError?: { message: string } | null;
  financeUsers?: { id: string; full_name: string }[];
  creatorProfile?: { id: string; full_name: string } | null;
  authUsers?: { id: string; email: string | undefined }[];
};

function setupMocks({
  userId = "dist-1",
  role = "distributor",
  isActive = true,
  campaign = {
    id: "camp-1",
    status: "ongoing",
    name: "Promo A",
    created_by: "creator-1",
  },
  updateError = null,
  financeUsers = [{ id: "fin-1", full_name: "Finance One" }],
  creatorProfile = { id: "creator-1", full_name: "Creator One" },
  authUsers = [
    { id: "fin-1", email: "fin1@example.com" },
    { id: "creator-1", email: "creator1@example.com" },
  ],
}: SetupOptions = {}) {
  const campaignsChain = makeCampaignsChain(campaign, updateError);
  const claimEventsChain = { insert: vi.fn().mockResolvedValue({ error: null }) };

  const mockClient = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return makeQueryChain({ role, is_active: isActive });
      if (table === "campaigns") return campaignsChain;
      if (table === "claim_events") return claimEventsChain;
      return {};
    }),
  };

  const usersAdminChain = makeUsersAdminChain(financeUsers, creatorProfile);
  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return usersAdminChain;
      return {};
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: authUsers } }),
      },
    },
  };

  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

  return { campaignsChain, mockAdminClient, claimEventsChain };
}

describe("submitKlaimAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not distributor, admin, or superadmin", async () => {
    setupMocks({ role: "manager" });
    const result = await submitKlaimAction("camp-1", 1_000_000);
    expect(result).toEqual({
      error: "Hanya distributor atau admin yang dapat mengajukan klaim",
    });
  });

  it("returns error when claim amount is zero", async () => {
    setupMocks();
    const result = await submitKlaimAction("camp-1", 0);
    expect(result.error).toMatch(/nominal/i);
  });

  it("returns error when claim amount is negative", async () => {
    setupMocks();
    const result = await submitKlaimAction("camp-1", -500);
    expect(result.error).toMatch(/nominal/i);
  });

  it("returns error when campaign is not in ongoing status", async () => {
    setupMocks({
      campaign: {
        id: "camp-1",
        status: "approved",
        name: "Promo A",
        created_by: "creator-1",
      },
    });
    const result = await submitKlaimAction("camp-1", 1_000_000);
    expect(result).toEqual({
      error: "Hanya SKP berstatus Ongoing yang dapat diajukan klaimnya",
    });
  });

  it("returns error when db update fails", async () => {
    setupMocks({ updateError: { message: "DB constraint violation" } });
    const result = await submitKlaimAction("camp-1", 1_000_000);
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("distributor happy path: updates campaign, revalidates, notifies, returns success", async () => {
    const { campaignsChain, claimEventsChain } = setupMocks();

    const result = await submitKlaimAction("camp-1", 1_500_000);

    expect(result).toEqual({ success: true });

    expect(campaignsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "claim_submitted",
        claim_amount: 1_500_000,
        claim_submitted_by: "dist-1",
      })
    );

    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "dist-1",
      action: "submitted",
      claim_amount: 1_500_000,
    });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      "/campaigns/camp-1"
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");

    expect(sendClaimSubmittedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Promo A",
        claimAmount: 1_500_000,
        to: expect.arrayContaining([
          { email: "fin1@example.com", name: "Finance One" },
          { email: "creator1@example.com", name: "Creator One" },
        ]),
      })
    );
  });

  it("admin can also submit a claim as a fallback", async () => {
    setupMocks({ userId: "admin-1", role: "admin" });
    const result = await submitKlaimAction("camp-1", 2_000_000);
    expect(result).toEqual({ success: true });
  });

  it("still succeeds even if the notification step fails", async () => {
    setupMocks();
    vi.mocked(sendClaimSubmittedEmail).mockRejectedValueOnce(
      new Error("resend down")
    );

    const result = await submitKlaimAction("camp-1", 1_000_000);
    expect(result).toEqual({ success: true });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupMocks();
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));

    const result = await submitKlaimAction("camp-1", 1_000_000);
    expect(result).toEqual({ success: true });
  });
});

describe("cancelKlaimAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not distributor, admin, or superadmin", async () => {
    setupMocks({ role: "manager" });
    const result = await cancelKlaimAction("camp-1");
    expect(result).toEqual({
      error: "Hanya distributor atau admin yang dapat membatalkan klaim",
    });
  });

  it("returns error when campaign is not claim_submitted", async () => {
    setupMocks({
      campaign: {
        id: "camp-1",
        status: "ongoing",
        name: "Promo A",
        created_by: "creator-1",
      },
    });
    const result = await cancelKlaimAction("camp-1");
    expect(result).toEqual({
      error: "Hanya SKP berstatus Klaim Diajukan yang dapat dibatalkan",
    });
  });

  it("returns error when db update fails", async () => {
    setupMocks({
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        created_by: "creator-1",
      },
      updateError: { message: "DB constraint violation" },
    });
    const result = await cancelKlaimAction("camp-1");
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("distributor happy path: reverts campaign to ongoing, clears claim fields, logs history", async () => {
    const { campaignsChain, claimEventsChain } = setupMocks({
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        created_by: "creator-1",
      },
    });

    const result = await cancelKlaimAction("camp-1");

    expect(result).toEqual({ success: true });

    expect(campaignsChain.update).toHaveBeenCalledWith({
      status: "ongoing",
      claim_amount: null,
      claim_submitted_at: null,
      claim_submitted_by: null,
    });

    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "dist-1",
      action: "cancelled",
      claim_amount: null,
    });

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(
      "/campaigns/camp-1"
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");
  });

  it("admin can also cancel a claim as a fallback", async () => {
    setupMocks({
      userId: "admin-1",
      role: "admin",
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        created_by: "creator-1",
      },
    });
    const result = await cancelKlaimAction("camp-1");
    expect(result).toEqual({ success: true });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupMocks({
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        created_by: "creator-1",
      },
    });
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));

    const result = await cancelKlaimAction("camp-1");
    expect(result).toEqual({ success: true });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendClaimSubmittedEmail: vi.fn(),
  sendMarkedAsPaidEmail: vi.fn(),
}));

import {
  submitKlaimAction,
  cancelKlaimAction,
  markAsPaidAction,
  approveClaimAction,
  markReadyToPayAction,
} from "./realizations";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendClaimSubmittedEmail, sendMarkedAsPaidEmail } from "@/lib/email";

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

// Serves ensureClaimItemVerifications' admin-client reads/writes against
// "claim_item_verifications" and "claim_requirements" — empty by default
// (no pre-existing items, no document requirements) so submitKlaimAction's
// best-effort sync only ever inserts the single 'amount' item in tests.
function makeThenableAdminChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
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
  const claimItemVerificationsAdminChain = makeThenableAdminChain({ data: [] });
  const claimRequirementsAdminChain = makeThenableAdminChain({ data: [] });
  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return usersAdminChain;
      if (table === "claim_item_verifications") return claimItemVerificationsAdminChain;
      if (table === "claim_requirements") return claimRequirementsAdminChain;
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

  return {
    campaignsChain,
    mockAdminClient,
    claimEventsChain,
    claimItemVerificationsAdminChain,
  };
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

  it("creates the claim item verification rows via the admin client", async () => {
    const { claimItemVerificationsAdminChain } = setupMocks();

    const result = await submitKlaimAction("camp-1", 1_000_000);

    expect(result).toEqual({ success: true });
    expect(claimItemVerificationsAdminChain.insert).toHaveBeenCalledWith([
      { campaign_id: "camp-1", item_type: "amount", document_type_id: null, status: "pending" },
    ]);
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

// -------------------------------------------------------
// approveClaimAction & markReadyToPayAction
// -------------------------------------------------------

// Serves the verification transition actions: campaigns read/update +
// best-effort claim_events insert, plus (approveClaimAction only) the
// claim_item_verifications gate read. Defaults to a fully-accepted claim so
// existing approve/ready-to-pay tests don't need to know about the gate.
function setupVerificationMocks({
  userId = "fin-1",
  role = "finance",
  isActive = true,
  campaign = { id: "camp-1", status: "claim_submitted" } as
    | { id: string; status: string }
    | null,
  updateError = null as { message: string } | null,
  items = [{ status: "accepted" }] as { status: string }[],
} = {}) {
  const campaignsChain = makeCampaignsChain(campaign, updateError);
  const claimEventsChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
  const claimItemVerificationsChain: Record<string, unknown> = {};
  claimItemVerificationsChain.select = vi.fn().mockReturnValue(claimItemVerificationsChain);
  claimItemVerificationsChain.eq = vi.fn().mockReturnValue(claimItemVerificationsChain);
  claimItemVerificationsChain.then = (resolve: (v: unknown) => void) =>
    resolve({ data: items });

  const mockClient = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeQueryChain({ role, is_active: isActive });
      if (table === "campaigns") return campaignsChain;
      if (table === "claim_events") return claimEventsChain;
      if (table === "claim_item_verifications") return claimItemVerificationsChain;
      return {};
    }),
  };

  vi.mocked(createClient).mockResolvedValue(mockClient as never);

  return { campaignsChain, claimEventsChain, claimItemVerificationsChain };
}

describe("approveClaimAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not finance, admin, or superadmin", async () => {
    setupVerificationMocks({ role: "distributor" });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({
      error: "Hanya Finance atau Admin yang dapat meng-approve klaim",
    });
  });

  it("returns error when campaign is not claim_submitted", async () => {
    setupVerificationMocks({
      campaign: { id: "camp-1", status: "ongoing" },
    });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({
      error: "Hanya SKP berstatus Klaim Diajukan yang dapat di-approve",
    });
  });

  it("returns error when db update fails", async () => {
    setupVerificationMocks({ updateError: { message: "DB constraint violation" } });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("finance happy path: sets claim_verified, records event, revalidates", async () => {
    const { campaignsChain, claimEventsChain } = setupVerificationMocks();

    const result = await approveClaimAction("camp-1");

    expect(result).toEqual({ success: true });
    expect(campaignsChain.update).toHaveBeenCalledWith({
      status: "claim_verified",
    });
    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "fin-1",
      action: "claim_verified",
      claim_amount: null,
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns/camp-1");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");
  });

  it("admin can approve as a fallback", async () => {
    setupVerificationMocks({ userId: "admin-1", role: "admin" });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({ success: true });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupVerificationMocks();
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({ success: true });
  });

  it("blocks approval while any item is still pending", async () => {
    const { campaignsChain } = setupVerificationMocks({
      items: [{ status: "accepted" }, { status: "pending" }],
    });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({
      error:
        "Approve Klaim hanya dapat dilakukan setelah semua item (dokumen & nominal) berstatus Accepted",
    });
    expect(campaignsChain.update).not.toHaveBeenCalled();
  });

  it("blocks approval while any item has a revision requested", async () => {
    const { campaignsChain } = setupVerificationMocks({
      items: [{ status: "accepted" }, { status: "revision_requested" }],
    });
    const result = await approveClaimAction("camp-1");
    expect(result.error).toMatch(/accepted/i);
    expect(campaignsChain.update).not.toHaveBeenCalled();
  });

  it("blocks approval when no items exist yet for the claim", async () => {
    const { campaignsChain } = setupVerificationMocks({ items: [] });
    const result = await approveClaimAction("camp-1");
    expect(result.error).toMatch(/accepted/i);
    expect(campaignsChain.update).not.toHaveBeenCalled();
  });

  it("allows approval once every item is accepted", async () => {
    const { campaignsChain } = setupVerificationMocks({
      items: [{ status: "accepted" }, { status: "accepted" }],
    });
    const result = await approveClaimAction("camp-1");
    expect(result).toEqual({ success: true });
    expect(campaignsChain.update).toHaveBeenCalledWith({ status: "claim_verified" });
  });
});

describe("markReadyToPayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not finance, admin, or superadmin", async () => {
    setupVerificationMocks({ role: "manager" });
    const result = await markReadyToPayAction("camp-1");
    expect(result).toEqual({
      error:
        "Hanya Finance atau Admin yang dapat menandai SKP Akan Segera Dibayar",
    });
  });

  it("returns error when campaign is not claim_verified", async () => {
    setupVerificationMocks({
      campaign: { id: "camp-1", status: "claim_submitted" },
    });
    const result = await markReadyToPayAction("camp-1");
    expect(result).toEqual({
      error:
        "Hanya SKP berstatus Terverifikasi yang dapat ditandai Akan Segera Dibayar",
    });
  });

  it("finance happy path: sets ready_to_pay, records event, revalidates", async () => {
    const { campaignsChain, claimEventsChain } = setupVerificationMocks({
      campaign: { id: "camp-1", status: "claim_verified" },
    });

    const result = await markReadyToPayAction("camp-1");

    expect(result).toEqual({ success: true });
    expect(campaignsChain.update).toHaveBeenCalledWith({
      status: "ready_to_pay",
    });
    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "fin-1",
      action: "ready_to_pay",
      claim_amount: null,
    });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupVerificationMocks({
      campaign: { id: "camp-1", status: "claim_verified" },
    });
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));
    const result = await markReadyToPayAction("camp-1");
    expect(result).toEqual({ success: true });
  });
});

// -------------------------------------------------------
// markAsPaidAction
// -------------------------------------------------------

type PaidCampaign = {
  id: string;
  status: string;
  name: string;
  claim_amount: number | null;
  distributor_id: string | null;
};

function setupMarkAsPaidMocks({
  userId = "fin-1",
  role = "finance",
  isActive = true,
  campaign = {
    id: "camp-1",
    status: "ready_to_pay",
    name: "Promo A",
    claim_amount: 1_500_000,
    distributor_id: "dist-co-1",
  } as PaidCampaign | null,
  updateError = null as { message: string } | null,
  distributorUsers = [{ id: "dist-user-1", full_name: "Dist User One" }],
  authUsers = [{ id: "dist-user-1", email: "distuser1@example.com" }],
}: {
  userId?: string | null;
  role?: string;
  isActive?: boolean;
  campaign?: PaidCampaign | null;
  updateError?: { message: string } | null;
  distributorUsers?: { id: string; full_name: string }[];
  authUsers?: { id: string; email: string | undefined }[];
} = {}) {
  const campaignsChain = makeCampaignsChain(campaign, updateError);

  const mockClient = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeQueryChain({ role, is_active: isActive });
      if (table === "campaigns") return campaignsChain;
      return {};
    }),
  };

  const distributorUsersChain: Record<string, unknown> = { data: distributorUsers };
  distributorUsersChain.select = vi.fn().mockReturnValue(distributorUsersChain);
  distributorUsersChain.eq = vi.fn().mockReturnValue(distributorUsersChain);

  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return distributorUsersChain;
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

  return { campaignsChain, mockAdminClient, distributorUsersChain };
}

describe("markAsPaidAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not finance, admin, or superadmin", async () => {
    setupMarkAsPaidMocks({ role: "manager" });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({
      error: "Hanya Finance atau Admin yang dapat menandai SKP sebagai Paid",
    });
  });

  it("admin can mark a claim as paid (newly allowed role)", async () => {
    setupMarkAsPaidMocks({ userId: "admin-1", role: "admin" });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({ success: true });
  });

  it("finance can NOT mark paid from claim_submitted (must go through verification)", async () => {
    setupMarkAsPaidMocks({
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        claim_amount: 1_500_000,
        distributor_id: "dist-co-1",
      },
    });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({
      error: "Hanya SKP berstatus Akan Segera Dibayar yang dapat ditandai Paid",
    });
  });

  it("finance can NOT mark paid from claim_verified", async () => {
    setupMarkAsPaidMocks({
      campaign: {
        id: "camp-1",
        status: "claim_verified",
        name: "Promo A",
        claim_amount: 1_500_000,
        distributor_id: "dist-co-1",
      },
    });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({
      error: "Hanya SKP berstatus Akan Segera Dibayar yang dapat ditandai Paid",
    });
  });

  it.each(["claim_submitted", "claim_verified"])(
    "admin can still mark paid from %s (transition fallback)",
    async (status) => {
      setupMarkAsPaidMocks({
        userId: "admin-1",
        role: "admin",
        campaign: {
          id: "camp-1",
          status,
          name: "Promo A",
          claim_amount: 1_500_000,
          distributor_id: "dist-co-1",
        },
      });
      const result = await markAsPaidAction("camp-1");
      expect(result).toEqual({ success: true });
    }
  );

  it("returns error when campaign is not in a payable status (admin)", async () => {
    setupMarkAsPaidMocks({
      userId: "admin-1",
      role: "admin",
      campaign: {
        id: "camp-1",
        status: "ongoing",
        name: "Promo A",
        claim_amount: null,
        distributor_id: "dist-co-1",
      },
    });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({
      error:
        "Hanya SKP berstatus Klaim Diajukan, Terverifikasi, atau Akan Segera Dibayar yang dapat ditandai Paid",
    });
  });

  it("returns error when db update fails", async () => {
    setupMarkAsPaidMocks({ updateError: { message: "DB constraint violation" } });
    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("returns error when paidDate is in the future", async () => {
    setupMarkAsPaidMocks();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await markAsPaidAction("camp-1", future);
    expect(result.error).toMatch(/tanggal bayar/i);
  });

  it("happy path: defaults paid_at to now and paid_note to null when omitted", async () => {
    const { campaignsChain } = setupMarkAsPaidMocks();

    const result = await markAsPaidAction("camp-1");

    expect(result).toEqual({ success: true });
    expect(campaignsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "paid", paid_note: null })
    );
    const updateArg = (campaignsChain.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof updateArg.paid_at).toBe("string");

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns/camp-1");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");
  });

  it("stores the provided paidDate and note", async () => {
    const { campaignsChain } = setupMarkAsPaidMocks();

    const result = await markAsPaidAction("camp-1", "2026-08-10", "Dibayar via transfer BCA");

    expect(result).toEqual({ success: true });
    expect(campaignsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paid",
        paid_at: new Date("2026-08-10").toISOString(),
        paid_note: "Dibayar via transfer BCA",
      })
    );
  });

  it("notifies the campaign's distributor users by email", async () => {
    setupMarkAsPaidMocks();

    await markAsPaidAction("camp-1");

    expect(sendMarkedAsPaidEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Promo A",
        claimAmount: 1_500_000,
        to: [{ email: "distuser1@example.com", name: "Dist User One" }],
      })
    );
  });

  it("skips notification when the campaign has no distributor", async () => {
    setupMarkAsPaidMocks({
      campaign: {
        id: "camp-1",
        status: "ready_to_pay",
        name: "Promo A",
        claim_amount: 1_500_000,
        distributor_id: null,
      },
    });

    const result = await markAsPaidAction("camp-1");

    expect(result).toEqual({ success: true });
    expect(sendMarkedAsPaidEmail).not.toHaveBeenCalled();
  });

  it("still succeeds even if the notification step fails", async () => {
    setupMarkAsPaidMocks();
    vi.mocked(sendMarkedAsPaidEmail).mockRejectedValueOnce(new Error("resend down"));

    const result = await markAsPaidAction("camp-1");
    expect(result).toEqual({ success: true });
  });
});

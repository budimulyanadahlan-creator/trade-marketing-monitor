import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendClaimRevisionRequestedEmail: vi.fn(),
}));

import { acceptClaimItemAction, requestClaimItemRevisionAction } from "./claim-verification";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendClaimRevisionRequestedEmail } from "@/lib/email";

function makeQueryChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data }),
  };
}

// Supports select().eq().single() reads and update().eq() writes against the
// same "claim_item_verifications" table.
function makeItemsChain(
  item: unknown,
  updateError: { message: string } | null = null
) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: item }),
    error: updateError,
  });
  return chain;
}

type SetupOptions = {
  userId?: string | null;
  role?: string;
  isActive?: boolean;
  campaign?: { id: string; status: string; name?: string; distributor_id?: string | null } | null;
  item?:
    | {
        id: string;
        campaign_id: string;
        item_type: "document" | "amount";
        claim_document_types: { name: string } | null;
      }
    | null;
  updateError?: { message: string } | null;
  distributorUsers?: { id: string; full_name: string }[];
  authUsers?: { id: string; email: string | undefined }[];
};

function setupMocks({
  userId = "fin-1",
  role = "finance",
  isActive = true,
  campaign = { id: "camp-1", status: "claim_submitted", name: "Promo A", distributor_id: "dist-co-1" },
  item = {
    id: "item-1",
    campaign_id: "camp-1",
    item_type: "document",
    claim_document_types: { name: "Invoice" },
  },
  updateError = null,
  distributorUsers = [{ id: "dist-user-1", full_name: "Dist User One" }],
  authUsers = [{ id: "dist-user-1", email: "distuser1@example.com" }],
}: SetupOptions = {}) {
  const itemsChain = makeItemsChain(item, updateError);
  const claimEventsChain = { insert: vi.fn().mockResolvedValue({ error: null }) };

  const mockClient = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeQueryChain({ role, is_active: isActive });
      if (table === "campaigns") return makeQueryChain(campaign);
      if (table === "claim_item_verifications") return itemsChain;
      if (table === "claim_events") return claimEventsChain;
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

  return { itemsChain, claimEventsChain, mockAdminClient };
}

describe("acceptClaimItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not finance, admin, or superadmin", async () => {
    setupMocks({ role: "distributor" });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({
      error: "Hanya Finance atau Admin yang dapat memverifikasi item klaim",
    });
  });

  it("returns error when campaign is not claim_submitted", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "claim_verified" } });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({
      error: "Item hanya dapat diverifikasi saat SKP berstatus Klaim Diajukan",
    });
  });

  it("returns error when the item doesn't belong to the given campaign", async () => {
    setupMocks({
      item: {
        id: "item-1",
        campaign_id: "camp-other",
        item_type: "document",
        claim_document_types: { name: "Invoice" },
      },
    });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ error: "Item verifikasi tidak ditemukan" });
  });

  it("accepts without a note", async () => {
    const { itemsChain, claimEventsChain } = setupMocks();

    const result = await acceptClaimItemAction("camp-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(itemsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepted", note: null, actor_id: "fin-1" })
    );
    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "fin-1",
      action: "item_accepted",
      claim_amount: null,
      note: null,
      item_label: "Invoice",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns/camp-1");
  });

  it("accepts with an optional note", async () => {
    const { itemsChain } = setupMocks();

    const result = await acceptClaimItemAction("camp-1", "item-1", "Sudah sesuai");

    expect(result).toEqual({ success: true });
    expect(itemsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ note: "Sudah sesuai" })
    );
  });

  it("labels the amount item distinctly from document items", async () => {
    const { claimEventsChain } = setupMocks({
      item: { id: "item-2", campaign_id: "camp-1", item_type: "amount", claim_document_types: null },
    });

    await acceptClaimItemAction("camp-1", "item-2");

    expect(claimEventsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ item_label: "Nominal Klaim" })
    );
  });

  it("admin can accept as a fallback", async () => {
    setupMocks({ userId: "admin-1", role: "admin" });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ success: true });
  });

  it("returns error when db update fails", async () => {
    setupMocks({ updateError: { message: "DB constraint violation" } });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupMocks();
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ success: true });
  });

  it("does not send a revision-requested email on accept", async () => {
    setupMocks();
    await acceptClaimItemAction("camp-1", "item-1");
    expect(sendClaimRevisionRequestedEmail).not.toHaveBeenCalled();
  });
});

describe("requestClaimItemRevisionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty note", async () => {
    setupMocks();
    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "");
    expect(result.error).toMatch(/catatan wajib/i);
  });

  it("rejects a whitespace-only note", async () => {
    setupMocks();
    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "   ");
    expect(result.error).toMatch(/catatan wajib/i);
  });

  it("returns error when user is not finance, admin, or superadmin", async () => {
    setupMocks({ role: "manager" });
    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "Kurang jelas");
    expect(result).toEqual({
      error: "Hanya Finance atau Admin yang dapat memverifikasi item klaim",
    });
  });

  it("returns error when campaign is not claim_submitted", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "ongoing" } });
    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "Kurang jelas");
    expect(result).toEqual({
      error: "Item hanya dapat diverifikasi saat SKP berstatus Klaim Diajukan",
    });
  });

  it("finance happy path: sets revision_requested with the required note", async () => {
    const { itemsChain, claimEventsChain } = setupMocks();

    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "File buram, upload ulang");

    expect(result).toEqual({ success: true });
    expect(itemsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revision_requested",
        note: "File buram, upload ulang",
        actor_id: "fin-1",
      })
    );
    expect(claimEventsChain.insert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "fin-1",
      action: "item_revision_requested",
      claim_amount: null,
      note: "File buram, upload ulang",
      item_label: "Invoice",
    });
  });

  it("still succeeds even if the claim_events insert fails", async () => {
    const { claimEventsChain } = setupMocks();
    claimEventsChain.insert.mockRejectedValueOnce(new Error("db down"));
    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "Kurang jelas");
    expect(result).toEqual({ success: true });
  });

  it("notifies the campaign's distributor users by email with the item label and note", async () => {
    setupMocks();

    await requestClaimItemRevisionAction("camp-1", "item-1", "File buram, upload ulang");

    expect(sendClaimRevisionRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Promo A",
        itemLabel: "Invoice",
        note: "File buram, upload ulang",
        to: [{ email: "distuser1@example.com", name: "Dist User One" }],
      })
    );
  });

  it("labels the amount item distinctly in the notification email", async () => {
    setupMocks({
      item: { id: "item-2", campaign_id: "camp-1", item_type: "amount", claim_document_types: null },
    });

    await requestClaimItemRevisionAction("camp-1", "item-2", "Nominal tidak sesuai invoice");

    expect(sendClaimRevisionRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ itemLabel: "Nominal Klaim" })
    );
  });

  it("skips notification when the campaign has no distributor", async () => {
    setupMocks({
      campaign: { id: "camp-1", status: "claim_submitted", name: "Promo A", distributor_id: null },
    });

    await requestClaimItemRevisionAction("camp-1", "item-1", "Kurang jelas");

    expect(sendClaimRevisionRequestedEmail).not.toHaveBeenCalled();
  });

  it("still succeeds even if the notification step fails", async () => {
    setupMocks();
    vi.mocked(sendClaimRevisionRequestedEmail).mockRejectedValueOnce(new Error("resend down"));

    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "Kurang jelas");
    expect(result).toEqual({ success: true });
  });
});

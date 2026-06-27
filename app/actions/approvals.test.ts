import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/skp-number", () => ({
  generateSkpNumber: vi.fn().mockResolvedValue("0001/WWI/06/2026"),
}));

import { adminApproveCampaignAction, adminRejectCampaignAction } from "./approvals";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { generateSkpNumber } from "@/lib/skp-number";

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

function makeUpdateChain(error: { message: string } | null = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error }),
  };
  return chain;
}

function makeInsertChain(error: { message: string } | null = null) {
  return { insert: vi.fn().mockResolvedValue({ error }) };
}

type SetupOptions = {
  userId?: string;
  role?: string;
  isActive?: boolean;
  campaign?: { status: string; name: string } | null;
  updateError?: { message: string } | null;
};

function setupMocks({
  userId = "user-1",
  role = "admin",
  isActive = true,
  campaign = { status: "submitted", name: "Test SKP" },
  updateError = null,
}: SetupOptions = {}) {
  const adminCampaignsChain = makeUpdateChain(updateError);
  const adminHistoryChain = makeInsertChain();

  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "campaigns") return adminCampaignsChain;
      if (table === "approval_history") return adminHistoryChain;
      return {};
    }),
  };

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return makeQueryChain({ role, is_active: isActive, department_id: null });
      if (table === "campaigns") return makeQueryChain(campaign);
      return {};
    }),
  };

  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  vi.mocked(createAdminClient).mockReturnValue(mockAdminClient as never);

  return { mockAdminClient, adminCampaignsChain, adminHistoryChain };
}

// -------------------------------------------------------
// adminApproveCampaignAction
// -------------------------------------------------------

describe("adminApproveCampaignAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when aaReferenceNumber is empty", async () => {
    const result = await adminApproveCampaignAction("campaign-1", "");
    expect(result).toEqual({ error: "Nomor AA Reference harus diisi" });
  });

  it("returns error when aaReferenceNumber is whitespace-only", async () => {
    const result = await adminApproveCampaignAction("campaign-1", "   ");
    expect(result).toEqual({ error: "Nomor AA Reference harus diisi" });
  });

  it("returns error when user is not admin or superadmin", async () => {
    setupMocks({ role: "user" });
    const result = await adminApproveCampaignAction("campaign-1", "REF-001");
    expect(result).toEqual({
      error: "Hanya admin atau superadmin yang dapat menyetujui SKP",
    });
  });

  it("returns error when campaign is not found", async () => {
    setupMocks({ campaign: null });
    const result = await adminApproveCampaignAction("campaign-1", "REF-001");
    expect(result).toEqual({ error: "Campaign tidak ditemukan" });
  });

  it("returns error when campaign is not in submitted status", async () => {
    setupMocks({ campaign: { status: "approved", name: "Test SKP" } });
    const result = await adminApproveCampaignAction("campaign-1", "REF-001");
    expect(result).toEqual({
      error: "Hanya campaign berstatus 'submitted' yang dapat disetujui",
    });
  });

  it("returns error when db update fails", async () => {
    setupMocks({ updateError: { message: "DB constraint violation" } });
    const result = await adminApproveCampaignAction("campaign-1", "REF-001");
    expect(result).toEqual({ error: "DB constraint violation" });
  });

  it("happy path: updates campaign, inserts history, revalidates, returns success", async () => {
    const { adminCampaignsChain, adminHistoryChain } = setupMocks();
    vi.mocked(generateSkpNumber).mockResolvedValue("0001/WWI/06/2026");

    const result = await adminApproveCampaignAction("campaign-1", "REF-001");

    expect(result).toEqual({ success: true });

    expect(adminCampaignsChain.update).toHaveBeenCalledWith({
      status: "approved",
      skp_number: "0001/WWI/06/2026",
      aa_reference_number: "REF-001",
    });

    expect(adminHistoryChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "campaign-1",
        actor_id: "user-1",
        role: "admin",
        action: "approved",
      })
    );

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/approvals");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");
  });

  it("superadmin can also approve", async () => {
    setupMocks({ role: "superadmin" });
    const result = await adminApproveCampaignAction("campaign-1", "REF-001");
    expect(result).toEqual({ success: true });
  });
});

// -------------------------------------------------------
// adminRejectCampaignAction
// -------------------------------------------------------

describe("adminRejectCampaignAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when comment is empty", async () => {
    const result = await adminRejectCampaignAction("campaign-1", "");
    expect(result).toEqual({ error: "Alasan penolakan harus diisi" });
  });

  it("returns error when comment is whitespace-only", async () => {
    const result = await adminRejectCampaignAction("campaign-1", "   ");
    expect(result).toEqual({ error: "Alasan penolakan harus diisi" });
  });

  it("returns error when user is not admin or superadmin", async () => {
    setupMocks({ role: "manager" });
    const result = await adminRejectCampaignAction("campaign-1", "Tidak memenuhi syarat");
    expect(result).toEqual({
      error: "Hanya admin atau superadmin yang dapat menolak SKP",
    });
  });

  it("returns error when campaign is not found", async () => {
    setupMocks({ campaign: null });
    const result = await adminRejectCampaignAction("campaign-1", "Alasan penolakan");
    expect(result).toEqual({ error: "Campaign tidak ditemukan" });
  });

  it("returns error when campaign is not in submitted status", async () => {
    setupMocks({ campaign: { status: "draft", name: "Test SKP" } });
    const result = await adminRejectCampaignAction("campaign-1", "Alasan penolakan");
    expect(result).toEqual({
      error: "Hanya campaign berstatus 'submitted' yang dapat ditolak",
    });
  });

  it("happy path: updates campaign to rejected, inserts history, revalidates, returns success", async () => {
    const { adminCampaignsChain, adminHistoryChain } = setupMocks();

    const result = await adminRejectCampaignAction("campaign-1", "Tidak memenuhi syarat");

    expect(result).toEqual({ success: true });

    expect(adminCampaignsChain.update).toHaveBeenCalledWith({ status: "rejected" });

    expect(adminHistoryChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "campaign-1",
        actor_id: "user-1",
        role: "admin",
        action: "rejected",
        comment: "Tidak memenuhi syarat",
      })
    );

    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/approvals");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/campaigns");
  });
});

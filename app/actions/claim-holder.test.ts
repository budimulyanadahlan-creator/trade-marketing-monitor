import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({
  sendClaimHolderTransferredEmail: vi.fn(),
}));

import { transferClaimHolderAction } from "./claim-holder";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendClaimHolderTransferredEmail } from "@/lib/email";

type Profile = { id: string; role: string; is_active: boolean; full_name: string; distributor_id: string | null };

const ADMIN: Profile = { id: "admin-1", role: "admin", is_active: true, full_name: "Admin Satu", distributor_id: null };
const HOLDER_A: Profile = { id: "user-a", role: "distributor", is_active: true, full_name: "Ani", distributor_id: "co-edm" };
const COLLEAGUE_B: Profile = { id: "user-b", role: "distributor", is_active: true, full_name: "Budi", distributor_id: "co-edm" };

type SetupOptions = {
  actor?: Profile | null;
  campaign?: Record<string, unknown> | null;
  users?: Profile[];
  updateError?: { message: string } | null;
  updatedRows?: { id: string }[];
  newHolderEmail?: string | null;
};

function setupMocks({
  actor = ADMIN,
  campaign = {
    id: "camp-1",
    name: "Promo A",
    status: "claim_submitted",
    distributor_id: "co-edm",
    claim_submitted_by: "user-a",
  },
  users = [ADMIN, HOLDER_A, COLLEAGUE_B],
  updateError = null,
  updatedRows = [{ id: "camp-1" }],
  newHolderEmail = "budi@edm.co.id",
}: SetupOptions = {}) {
  const campaignUpdate = vi.fn();
  const updateChain: Record<string, unknown> = {};
  updateChain.eq = vi.fn().mockReturnValue(updateChain);
  updateChain.is = vi.fn().mockReturnValue(updateChain);
  updateChain.select = vi.fn().mockResolvedValue({ data: updatedRows, error: updateError });
  campaignUpdate.mockReturnValue(updateChain);

  const claimEventsInsert = vi.fn().mockResolvedValue({ error: null });

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: actor ? { id: actor.id } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        let wantedId: string | null = null;
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockImplementation((_col: string, val: string) => {
          wantedId = val;
          return chain;
        });
        chain.maybeSingle = vi
          .fn()
          .mockImplementation(async () => ({ data: users.find((u) => u.id === wantedId) ?? null }));
        chain.single = chain.maybeSingle;
        return chain;
      }
      if (table === "campaigns") {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.single = vi.fn().mockResolvedValue({ data: campaign });
        chain.update = campaignUpdate;
        return chain;
      }
      if (table === "claim_events") return { insert: claimEventsInsert };
      throw new Error(`unexpected table ${table}`);
    }),
  };
  vi.mocked(createClient).mockResolvedValue(mockClient as never);

  const getUserById = vi
    .fn()
    .mockResolvedValue({ data: { user: newHolderEmail ? { email: newHolderEmail } : null } });
  vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { getUserById } } } as never);

  return { campaignUpdate, updateChain, claimEventsInsert, getUserById };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("transferClaimHolderAction", () => {
  it("admin mengalihkan pemegang klaim ke rekan satu perusahaan", async () => {
    const { campaignUpdate } = setupMocks();

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result).toEqual({ success: true });
    expect(campaignUpdate).toHaveBeenCalledWith({ claim_submitted_by: "user-b" });
  });

  it("hanya mengganti pemegang — status SKP tidak ikut diubah, dan dikunci ke status + pemegang lama", async () => {
    const { campaignUpdate, updateChain } = setupMocks();

    await transferClaimHolderAction("camp-1", "user-b");

    const payload = campaignUpdate.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(["claim_submitted_by"]);
    expect(updateChain.eq).toHaveBeenCalledWith("status", "claim_submitted");
    expect(updateChain.eq).toHaveBeenCalledWith("claim_submitted_by", "user-a");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/camp-1");
  });

  it("mencatat holder_transferred di riwayat klaim (lama, baru, pelaku)", async () => {
    const { claimEventsInsert } = setupMocks();

    await transferClaimHolderAction("camp-1", "user-b");

    expect(claimEventsInsert).toHaveBeenCalledWith({
      campaign_id: "camp-1",
      actor_id: "admin-1",
      action: "holder_transferred",
      claim_amount: null,
      from_user_id: "user-a",
      to_user_id: "user-b",
    });
  });

  it("mengirim email ke pemegang baru", async () => {
    setupMocks();

    await transferClaimHolderAction("camp-1", "user-b");

    expect(sendClaimHolderTransferredEmail).toHaveBeenCalledWith({
      to: [{ email: "budi@edm.co.id", name: "Budi" }],
      campaignId: "camp-1",
      campaignName: "Promo A",
      previousHolderName: "Ani",
      transferredByName: "Admin Satu",
    });
  });

  it("kegagalan email tidak menggagalkan pengalihan", async () => {
    setupMocks();
    vi.mocked(sendClaimHolderTransferredEmail).mockRejectedValueOnce(new Error("SMTP down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result).toEqual({ success: true });
    spy.mockRestore();
  });

  it("non-admin (termasuk pemegang klaim) ditolak tanpa menulis apa pun", async () => {
    const { campaignUpdate, claimEventsInsert } = setupMocks({ actor: HOLDER_A });

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result.error).toBe("Hanya admin yang dapat mengalihkan pemegang klaim");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(claimEventsInsert).not.toHaveBeenCalled();
    expect(sendClaimHolderTransferredEmail).not.toHaveBeenCalled();
  });

  it("menolak SKP yang tidak berstatus Klaim Diajukan", async () => {
    const { campaignUpdate } = setupMocks({
      campaign: {
        id: "camp-1",
        name: "Promo A",
        status: "claim_verified",
        distributor_id: "co-edm",
        claim_submitted_by: "user-a",
      },
    });

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result.error).toMatch(/Klaim Diajukan/);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("menolak akun dari perusahaan induk", async () => {
    const pusatEdm: Profile = { ...COLLEAGUE_B, id: "user-p", distributor_id: "co-edm" };
    const { campaignUpdate } = setupMocks({
      campaign: {
        id: "camp-1",
        name: "Promo MMS",
        status: "claim_submitted",
        distributor_id: "co-mms",
        claim_submitted_by: "user-m",
      },
      users: [ADMIN, pusatEdm],
    });

    const result = await transferClaimHolderAction("camp-1", "user-p");

    expect(result.error).toBe("Pemegang baru harus dari perusahaan distributor SKP ini");
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("menolak akun yang tidak ditemukan", async () => {
    setupMocks();
    const result = await transferClaimHolderAction("camp-1", "ghost");
    expect(result.error).toBe("Akun pemegang baru tidak ditemukan");
  });

  it("SKP berubah di antara baca dan tulis → ditolak, tanpa riwayat & email", async () => {
    const { claimEventsInsert } = setupMocks({ updatedRows: [] });

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result.error).toMatch(/muat ulang/);
    expect(claimEventsInsert).not.toHaveBeenCalled();
    expect(sendClaimHolderTransferredEmail).not.toHaveBeenCalled();
  });

  it("klaim tanpa pemegang tercatat: dikunci ke claim_submitted_by is null", async () => {
    const { updateChain, claimEventsInsert } = setupMocks({
      campaign: {
        id: "camp-1",
        name: "Promo A",
        status: "claim_submitted",
        distributor_id: "co-edm",
        claim_submitted_by: null,
      },
    });

    const result = await transferClaimHolderAction("camp-1", "user-b");

    expect(result).toEqual({ success: true });
    expect(updateChain.is).toHaveBeenCalledWith("claim_submitted_by", null);
    expect(claimEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ from_user_id: null, to_user_id: "user-b" })
    );
  });
});

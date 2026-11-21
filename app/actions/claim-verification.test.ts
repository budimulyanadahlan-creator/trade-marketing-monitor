import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/distributor-notification-recipients", () => ({
  getDistributorNotificationRecipients: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendClaimRevisionRequestedEmail: vi.fn(),
}));
vi.mock("@/lib/claim-document-uploaders-data", () => ({
  fetchAppointedUploadersByDocType: vi.fn(),
}));

import { acceptClaimItemAction, requestClaimItemRevisionAction } from "./claim-verification";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { sendClaimRevisionRequestedEmail } from "@/lib/email";
import { getDistributorNotificationRecipients } from "@/lib/distributor-notification-recipients";
import { fetchAppointedUploadersByDocType } from "@/lib/claim-document-uploaders-data";
import { SPECIAL_UPLOADER_MESSAGES } from "@/lib/claim-document-uploaders";

// Fase 11: penerima email distributor ditentukan modul penerima (diuji
// tersendiri); di sini cukup dipastikan aksi memakainya dengan tahap
// "after_claim".
const DIST_RECIPIENT = { id: "dist-user-1", email: "distuser1@example.com", name: "Dist User One" };
beforeEach(() => {
  vi.mocked(getDistributorNotificationRecipients).mockResolvedValue([DIST_RECIPIENT]);
  // Default: tidak ada pengunggah khusus → tidak ada item terkunci.
  vi.mocked(fetchAppointedUploadersByDocType).mockResolvedValue(new Map());
});

// Pengunggah Khusus Fase 5: "doc-1" ditunjuk ke akun Pusat perusahaan
// distributorId → item itu terkunci di SKP perusahaan tsb. dan anaknya.
function appointUploader(distributorId = "dist-co-1", isActive = true) {
  vi.mocked(fetchAppointedUploadersByDocType).mockResolvedValue(
    new Map([
      [
        "doc-1",
        [{ id: "meriana", role: "distributor" as const, is_active: isActive, distributor_id: distributorId }],
      ],
    ])
  );
}

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
  campaign?: {
    id: string;
    status: string;
    name?: string;
    distributor_id?: string | null;
    distributor?: { parent_distributor_id: string | null } | null;
  } | null;
  item?:
    | {
        id: string;
        campaign_id: string;
        item_type: "document" | "amount";
        document_type_id?: string | null;
        claim_document_types: { name: string } | null;
      }
    | null;
  updateError?: { message: string } | null;
  distributorUsers?: { id: string; full_name: string }[];
  authUsers?: { id: string; email: string | undefined }[];
  /** Jumlah file jenis dokumen item itu di SKP (dibaca lewat klien sistem). */
  fileCount?: number;
  fileCountError?: { message: string } | null;
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
    document_type_id: "doc-1",
    claim_document_types: { name: "Invoice" },
  },
  updateError = null,
  fileCount = 0,
  fileCountError = null,
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

  // select(..., { count, head }).eq().eq() → { count, error }
  const filesChain: Record<string, unknown> = { count: fileCount, error: fileCountError };
  filesChain.select = vi.fn().mockReturnValue(filesChain);
  filesChain.eq = vi.fn().mockReturnValue(filesChain);

  const mockAdminClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return distributorUsersChain;
      if (table === "campaign_files") return filesChain;
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

  return { itemsChain, claimEventsChain, mockAdminClient, filesChain };
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

describe("acceptClaimItemAction — item terkunci (Pengunggah Khusus Fase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects Accept on a locked document item that has no file yet", async () => {
    appointUploader();
    const { itemsChain, claimEventsChain, filesChain } = setupMocks({ fileCount: 0 });

    const result = await acceptClaimItemAction("camp-1", "item-1");

    expect(result).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.awaitingPusat });
    expect(itemsChain.update).not.toHaveBeenCalled();
    expect(claimEventsChain.insert).not.toHaveBeenCalled();
    expect(filesChain.eq).toHaveBeenCalledWith("campaign_id", "camp-1");
    expect(filesChain.eq).toHaveBeenCalledWith("document_type_id", "doc-1");
  });

  it("accepts a locked item once a file exists", async () => {
    appointUploader();
    const { itemsChain } = setupMocks({ fileCount: 1 });

    const result = await acceptClaimItemAction("camp-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(itemsChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "accepted" }));
  });

  it("locks through the parent company: uploader of the induk, SKP of the anak perusahaan", async () => {
    appointUploader("edm");
    setupMocks({
      campaign: {
        id: "camp-1",
        status: "claim_submitted",
        name: "Promo A",
        distributor_id: "mms",
        distributor: { parent_distributor_id: "edm" },
      },
    });

    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.awaitingPusat });
  });

  it("admin is held to the same rule", async () => {
    appointUploader();
    setupMocks({ userId: "admin-1", role: "admin" });
    const result = await acceptClaimItemAction("camp-1", "item-1");
    expect(result).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.awaitingPusat });
  });

  it("unlocked item without a file is still accepted (old rule unchanged)", async () => {
    const { filesChain } = setupMocks({ fileCount: 0 });

    const result = await acceptClaimItemAction("camp-1", "item-1");

    expect(result).toEqual({ success: true });
    expect(filesChain.select).not.toHaveBeenCalled();
  });

  it("not locked when the only appointed uploader is inactive, or belongs to another group", async () => {
    appointUploader("dist-co-1", false);
    setupMocks();
    expect(await acceptClaimItemAction("camp-1", "item-1")).toEqual({ success: true });

    appointUploader("grup-lain");
    setupMocks();
    expect(await acceptClaimItemAction("camp-1", "item-1")).toEqual({ success: true });
  });

  it("the amount item is never subject to the locked-document rule", async () => {
    appointUploader();
    setupMocks({
      item: { id: "item-2", campaign_id: "camp-1", item_type: "amount", document_type_id: null, claim_document_types: null },
    });

    expect(await acceptClaimItemAction("camp-1", "item-2")).toEqual({ success: true });
    expect(fetchAppointedUploadersByDocType).not.toHaveBeenCalled();
  });

  it("Minta Revisi stays allowed on a locked item without a file", async () => {
    appointUploader();
    const { itemsChain } = setupMocks({ fileCount: 0 });

    const result = await requestClaimItemRevisionAction("camp-1", "item-1", "Surat belum ada");

    expect(result).toEqual({ success: true });
    expect(itemsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revision_requested" })
    );
  });

  it("fails closed when the file count cannot be read", async () => {
    appointUploader();
    const { itemsChain } = setupMocks({ fileCountError: { message: "db down" } });

    const result = await acceptClaimItemAction("camp-1", "item-1");

    expect(result).toEqual({ error: "db down" });
    expect(itemsChain.update).not.toHaveBeenCalled();
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
        to: [DIST_RECIPIENT],
      })
    );
    expect(getDistributorNotificationRecipients).toHaveBeenCalledWith(
      expect.anything(),
      "camp-1",
      "after_claim"
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

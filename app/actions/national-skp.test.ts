import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { makeNationalAction, unmakeNationalAction } from "./national-skp";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { NATIONAL_SKP_MESSAGES } from "@/lib/national-skp";

const NATIONAL_REGION = { id: "region-national", name: "National" };

type Campaign = {
  id: string;
  status: string;
  is_national: boolean;
  claim_amount: number | null;
  claim_submitted_by: string | null;
  department: { name: string } | null;
};

const APPROVED: Campaign = {
  id: "camp-1",
  status: "approved",
  is_national: false,
  claim_amount: null,
  claim_submitted_by: null,
  department: { name: "Sales" },
};

type Counts = Partial<
  Record<
    | "realizations"
    | "distributor_claim_checklists"
    | "campaign_files"
    | "distributor_receipts"
    | "claim_events",
    number
  >
>;

/** Rantai query serba guna: semua method mengembalikan rantai, hasil lewat await / single. */
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "ilike", "update", "limit"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.single = vi.fn().mockResolvedValue(result);
  c.maybeSingle = vi.fn().mockResolvedValue(result);
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function setupMocks({
  role = "admin",
  isActive = true,
  campaign = APPROVED as Campaign | null,
  counts = {} as Counts,
  region = NATIONAL_REGION as { id: string; name: string } | null,
  updatedRows = [{ id: "camp-1" }] as { id: string }[],
  updateError = null as { message: string } | null,
} = {}) {
  const campaignRead = chain({ data: campaign });
  const campaignWrite = chain({ data: updatedRows, error: updateError });
  const campaignsTable = {
    select: vi.fn().mockReturnValue(campaignRead),
    update: vi.fn().mockReturnValue(campaignWrite),
  };

  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return chain({ data: { role, is_active: isActive } });
      if (table === "campaigns") return campaignsTable;
      if (table === "regions") return chain({ data: region });
      return chain({ count: counts[table as keyof Counts] ?? 0, error: null });
    }),
  };

  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  return { campaignsTable, campaignWrite };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeNationalAction", () => {
  it("admin menjadikan SKP Disetujui nasional: distributor dikosongkan, region pindah ke National", async () => {
    const { campaignsTable, campaignWrite } = setupMocks();

    const result = await makeNationalAction("camp-1");

    expect(result).toEqual({ success: true });
    expect(campaignsTable.update).toHaveBeenCalledWith({
      is_national: true,
      distributor_id: null,
      region_id: "region-national",
    });
    // Hanya menimpa baris yang masih Disetujui dan belum nasional.
    expect(campaignWrite.eq).toHaveBeenCalledWith("id", "camp-1");
    expect(campaignWrite.eq).toHaveBeenCalledWith("status", "approved");
    expect(campaignWrite.eq).toHaveBeenCalledWith("is_national", false);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/camp-1");
  });

  it("role selain admin/superadmin ditolak tanpa menulis", async () => {
    for (const role of ["manager", "finance", "user", "distributor"]) {
      const { campaignsTable } = setupMocks({ role });
      expect(await makeNationalAction("camp-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notAdmin });
      expect(campaignsTable.update).not.toHaveBeenCalled();
    }
  });

  it("akun nonaktif ditolak", async () => {
    setupMocks({ isActive: false });
    expect(await makeNationalAction("camp-1")).toEqual({ error: "Akun tidak aktif" });
  });

  it("SKP tidak ditemukan", async () => {
    setupMocks({ campaign: null });
    expect(await makeNationalAction("camp-1")).toEqual({ error: "SKP tidak ditemukan" });
  });

  it("SKP bukan Disetujui ditolak", async () => {
    const { campaignsTable } = setupMocks({ campaign: { ...APPROVED, status: "ongoing" } });
    expect(await makeNationalAction("camp-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notApproved });
    expect(campaignsTable.update).not.toHaveBeenCalled();
  });

  it("penolakan karena aktivitas klaim menyebut penyebabnya", async () => {
    const { campaignsTable } = setupMocks({
      counts: { realizations: 1, distributor_receipts: 1 },
    });
    const result = await makeNationalAction("camp-1");
    expect(result.error).toBe(
      "SKP tidak dapat dijadikan Nasional karena sudah punya tanda terima, realisasi. Bereskan dulu, lalu coba lagi."
    );
    expect(campaignsTable.update).not.toHaveBeenCalled();
  });

  it("tiap jenis aktivitas klaim memblokir", async () => {
    const cases: [keyof Counts, string][] = [
      ["distributor_claim_checklists", "checklist terisi"],
      ["campaign_files", "dokumen klaim"],
      ["claim_events", "klaim"],
    ];
    for (const [table, label] of cases) {
      setupMocks({ counts: { [table]: 1 } });
      expect((await makeNationalAction("camp-1")).error).toContain(label);
    }
  });

  it("gagal dengan pesan jelas bila region National tidak ada di master data", async () => {
    const { campaignsTable } = setupMocks({ region: null });
    expect((await makeNationalAction("camp-1")).error).toContain("Region National");
    expect(campaignsTable.update).not.toHaveBeenCalled();
  });

  it("meneruskan penolakan database dan mendeteksi SKP yang berubah di tengah jalan", async () => {
    setupMocks({ updateError: { message: "ditolak trigger" } });
    expect(await makeNationalAction("camp-1")).toEqual({ error: "ditolak trigger" });

    setupMocks({ updatedRows: [] });
    expect((await makeNationalAction("camp-1")).error).toContain("muat ulang");
  });
});

describe("unmakeNationalAction", () => {
  const NATIONAL: Campaign = { ...APPROVED, is_national: true };

  it("admin mencabut tanda nasional", async () => {
    const { campaignsTable, campaignWrite } = setupMocks({ campaign: NATIONAL });

    expect(await unmakeNationalAction("camp-1")).toEqual({ success: true });
    expect(campaignsTable.update).toHaveBeenCalledWith({ is_national: false });
    expect(campaignWrite.eq).toHaveBeenCalledWith("is_national", true);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/camp-1");
  });

  it("role lain dan SKP bukan nasional ditolak tanpa menulis", async () => {
    let mocks = setupMocks({ campaign: NATIONAL, role: "finance" });
    expect(await unmakeNationalAction("camp-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notAdmin });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupMocks({ campaign: APPROVED });
    expect(await unmakeNationalAction("camp-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notNational });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();
  });
});

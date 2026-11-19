import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createChildClaimAction,
  makeNationalAction,
  unmakeNationalAction,
} from "./national-skp";
import { createClient, createAdminClient } from "@/lib/supabase/server";
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
  for (const m of ["select", "eq", "in", "is", "not", "ilike", "update", "limit"]) {
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
  childClaims = 0,
  region = NATIONAL_REGION as { id: string; name: string } | null,
  updatedRows = [{ id: "camp-1" }] as { id: string }[],
  updateError = null as { message: string } | null,
} = {}) {
  const campaignRead = chain({ data: campaign });
  const campaignWrite = chain({ data: updatedRows, error: updateError });
  const campaignsTable = {
    // head-count = hitungan klaim turunan (unmakeNationalAction)
    select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) =>
      opts?.head ? chain({ count: childClaims, error: null }) : campaignRead
    ),
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

// ============================================================
// Fase 2: Buat Klaim (klaim turunan)
// ============================================================

type Parent = {
  id: string;
  status: string;
  is_national: boolean;
  parent_campaign_id: string | null;
  skp_number: string | null;
};

const PARENT: Parent = {
  id: "induk-1",
  status: "approved",
  is_national: true,
  parent_campaign_id: null,
  skp_number: "0049/WWI/11/2026",
};

function setupChildMocks({
  role = "distributor",
  isActive = true,
  distributorId = "co-edm" as string | null,
  parent = PARENT as Parent | null,
  openClaims = 0,
  rpcResult = { data: "turunan-1", error: null } as {
    data: string | null;
    error: { message: string; code?: string } | null;
  },
} = {}) {
  const openClaimsQuery = chain({ count: openClaims, error: null });
  const campaignsTable = {
    select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) =>
      opts?.head ? openClaimsQuery : chain({ data: parent })
    ),
  };
  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "dist-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        return chain({ data: { role, is_active: isActive, distributor_id: distributorId } });
      }
      if (table === "campaigns") return campaignsTable;
      throw new Error(`tabel tak terduga: ${table}`);
    }),
  };
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return { rpc, openClaimsQuery };
}

describe("createChildClaimAction", () => {
  it("akun distributor membuat klaim turunan dan menerima ID-nya", async () => {
    const { rpc, openClaimsQuery } = setupChildMocks();

    const result = await createChildClaimAction("induk-1");

    expect(result).toEqual({ success: true, childId: "turunan-1" });
    // Pemilik selalu akun yang login — tidak pernah dari input.
    expect(rpc).toHaveBeenCalledWith("create_national_child_claim", {
      p_parent_id: "induk-1",
      p_owner_id: "dist-1",
    });
    // Klaim belum diajukan dihitung untuk akun ini pada induk ini saja.
    expect(openClaimsQuery.eq).toHaveBeenCalledWith("parent_campaign_id", "induk-1");
    expect(openClaimsQuery.eq).toHaveBeenCalledWith("claim_owner_id", "dist-1");
    expect(openClaimsQuery.in).toHaveBeenCalledWith("status", ["approved", "ongoing"]);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/induk-1");
  });

  it("role selain distributor ditolak tanpa memanggil database layanan", async () => {
    for (const role of ["admin", "superadmin", "finance", "manager", "user"]) {
      const { rpc } = setupChildMocks({ role });
      expect(await createChildClaimAction("induk-1")).toEqual({
        error: NATIONAL_SKP_MESSAGES.childNotDistributor,
      });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("akun nonaktif dan akun tanpa perusahaan ditolak", async () => {
    let mocks = setupChildMocks({ isActive: false });
    expect(await createChildClaimAction("induk-1")).toEqual({ error: "Akun tidak aktif" });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks = setupChildMocks({ distributorId: null });
    expect(await createChildClaimAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.childNoCompany,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("SKP yang tidak terlihat akun (RLS) → tidak ditemukan", async () => {
    const { rpc } = setupChildMocks({ parent: null });
    expect(await createChildClaimAction("induk-1")).toEqual({ error: "SKP tidak ditemukan" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SKP biasa, klaim turunan, dan induk yang bukan Disetujui ditolak", async () => {
    let mocks = setupChildMocks({ parent: { ...PARENT, is_national: false } });
    expect(await createChildClaimAction("induk-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notNational });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks = setupChildMocks({ parent: { ...PARENT, is_national: false, parent_campaign_id: "x" } });
    expect(await createChildClaimAction("induk-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notNational });

    mocks = setupChildMocks({ parent: { ...PARENT, status: "completed" } });
    expect(await createChildClaimAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.childParentNotApproved,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ditolak selama akun masih punya klaim turunan yang belum diajukan", async () => {
    const { rpc } = setupChildMocks({ openClaims: 1 });
    expect(await createChildClaimAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.childOpenClaimExists,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("penolakan database diteruskan sebagai pesan ramah; error teknis tidak bocor", async () => {
    setupChildMocks({
      rpcResult: {
        data: null,
        error: { code: "P0001", message: NATIONAL_SKP_MESSAGES.childOpenClaimExists },
      },
    });
    expect(await createChildClaimAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.childOpenClaimExists,
    });

    setupChildMocks({
      rpcResult: {
        data: null,
        error: { code: "23505", message: 'duplicate key value violates unique constraint "x"' },
      },
    });
    const result = await createChildClaimAction("induk-1");
    expect(result.error).toBe("Klaim gagal dibuat — coba lagi sebentar lagi");
  });
});

describe("unmakeNationalAction — klaim turunan mengunci tanda nasional", () => {
  it("ditolak bila induk sudah punya klaim turunan", async () => {
    const { campaignsTable } = setupMocks({
      campaign: { ...APPROVED, is_national: true },
      childClaims: 2,
    });
    expect(await unmakeNationalAction("camp-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.hasChildClaims,
    });
    expect(campaignsTable.update).not.toHaveBeenCalled();
  });
});

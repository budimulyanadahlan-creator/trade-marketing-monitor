import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  cancelChildClaimAction,
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
  for (const m of ["select", "eq", "neq", "in", "is", "not", "ilike", "update", "limit"]) {
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
  national_closed_at?: string | null;
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

// ============================================================
// Fase 3: Batalkan Klaim (klaim turunan)
// ============================================================

type Child = {
  id: string;
  status: string;
  parent_campaign_id: string | null;
  claim_owner_id: string | null;
};

const CHILD: Child = {
  id: "turunan-1",
  status: "approved",
  parent_campaign_id: "induk-1",
  claim_owner_id: "dist-1",
};

function setupCancelMocks({
  userId = "dist-1",
  role = "distributor",
  isActive = true,
  child = CHILD as Child | null,
  realizations = 0,
  rpcResult = { data: null, error: null } as {
    data: null;
    error: { message: string; code?: string } | null;
  },
} = {}) {
  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return chain({ data: { role, is_active: isActive } });
      if (table === "campaigns") return chain({ data: child });
      if (table === "realizations") return chain({ count: realizations, error: null });
      throw new Error(`tabel tak terduga: ${table}`);
    }),
  };
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return { rpc };
}

describe("cancelChildClaimAction", () => {
  it("pemilik membatalkan klaim turunannya yang belum diajukan", async () => {
    const { rpc } = setupCancelMocks();

    expect(await cancelChildClaimAction("turunan-1")).toEqual({ success: true });
    // Pelaku selalu akun yang login — tidak pernah dari input.
    expect(rpc).toHaveBeenCalledWith("cancel_national_child_claim", {
      p_child_id: "turunan-1",
      p_actor_id: "dist-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/turunan-1");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/induk-1");
  });

  it("admin dan superadmin membatalkan klaim turunan akun lain", async () => {
    for (const role of ["admin", "superadmin"]) {
      const { rpc } = setupCancelMocks({ userId: "admin-1", role });
      expect(await cancelChildClaimAction("turunan-1")).toEqual({ success: true });
      expect(rpc).toHaveBeenCalledWith("cancel_national_child_claim", {
        p_child_id: "turunan-1",
        p_actor_id: "admin-1",
      });
    }
  });

  it("akun distributor lain dan role internal lain ditolak tanpa menulis", async () => {
    let mocks = setupCancelMocks({ userId: "dist-2" });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelNotOwner,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    for (const role of ["finance", "manager", "user"]) {
      mocks = setupCancelMocks({ role });
      expect(await cancelChildClaimAction("turunan-1")).toEqual({
        error: NATIONAL_SKP_MESSAGES.cancelNotOwner,
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });

  it("akun nonaktif ditolak", async () => {
    const { rpc } = setupCancelMocks({ isActive: false });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({ error: "Akun tidak aktif" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("klaim yang tidak terlihat akun (RLS) → tidak ditemukan", async () => {
    const { rpc } = setupCancelMocks({ child: null });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({ error: "Klaim tidak ditemukan" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SKP biasa bukan klaim turunan", async () => {
    const { rpc } = setupCancelMocks({
      child: { ...CHILD, parent_campaign_id: null, claim_owner_id: null },
      role: "admin",
    });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelNotChild,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ditolak bila sudah ada realisasi atau sudah diajukan", async () => {
    let mocks = setupCancelMocks({ realizations: 1 });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelHasRealization,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks = setupCancelMocks({ child: { ...CHILD, status: "ongoing" } });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelHasRealization,
    });

    mocks = setupCancelMocks({ child: { ...CHILD, status: "claim_submitted" } });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelAlreadySubmitted,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("penolakan database diteruskan sebagai pesan ramah; error teknis tidak bocor", async () => {
    setupCancelMocks({
      rpcResult: {
        data: null,
        error: { code: "P0001", message: NATIONAL_SKP_MESSAGES.cancelHasRealization },
      },
    });
    expect(await cancelChildClaimAction("turunan-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.cancelHasRealization,
    });

    setupCancelMocks({
      rpcResult: { data: null, error: { code: "42883", message: "function does not exist" } },
    });
    expect((await cancelChildClaimAction("turunan-1")).error).toBe(
      "Klaim gagal dibatalkan — coba lagi sebentar lagi"
    );
  });
});

// ============================================================
// Batas klaim, tutup, dan buka kembali (Fase 7)
// ============================================================

import {
  closeNationalAction,
  reopenNationalAction,
  setClaimDeadlineAction,
} from "./national-skp";

type NationalParentRow = {
  id: string;
  status: string;
  is_national: boolean;
  parent_campaign_id: string | null;
  national_closed_at: string | null;
};

const OPEN_PARENT: NationalParentRow = {
  id: "induk-1",
  status: "approved",
  is_national: true,
  parent_campaign_id: null,
  national_closed_at: null,
};

function setupCloseMocks({
  role = "admin",
  campaign = OPEN_PARENT as NationalParentRow | null,
  updatedRows = [{ id: "induk-1", status: "approved" }] as { id: string; status: string }[],
  updateError = null as { message: string } | null,
} = {}) {
  const campaignWrite = chain({ data: updatedRows, error: updateError });
  const campaignsTable = {
    select: vi.fn().mockReturnValue(chain({ data: campaign })),
    update: vi.fn().mockReturnValue(campaignWrite),
  };
  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return chain({ data: { role, is_active: true } });
      if (table === "campaigns") return campaignsTable;
      throw new Error(`tabel tak terduga: ${table}`);
    }),
  };
  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  return { campaignsTable, campaignWrite };
}

describe("createChildClaimAction — induk tertutup", () => {
  it("induk yang sudah ditutup menolak klaim baru tanpa memanggil database layanan", async () => {
    const { rpc } = setupChildMocks({
      parent: { ...PARENT, national_closed_at: "2026-11-20T03:00:00Z" },
    });
    expect(await createChildClaimAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.childParentClosed,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setClaimDeadlineAction", () => {
  it("admin mengisi batas klaim pada induk nasional", async () => {
    const { campaignsTable, campaignWrite } = setupCloseMocks();

    expect(await setClaimDeadlineAction("induk-1", "2026-12-31")).toEqual({ success: true });
    expect(campaignsTable.update).toHaveBeenCalledWith({ claim_deadline: "2026-12-31" });
    expect(campaignWrite.eq).toHaveBeenCalledWith("id", "induk-1");
    expect(campaignWrite.eq).toHaveBeenCalledWith("is_national", true);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/induk-1");
  });

  it("string kosong mengosongkan batas klaim", async () => {
    const { campaignsTable } = setupCloseMocks();
    expect(await setClaimDeadlineAction("induk-1", "")).toEqual({ success: true });
    expect(campaignsTable.update).toHaveBeenCalledWith({ claim_deadline: null });
  });

  it("role lain, SKP bukan nasional, dan tanggal ngawur ditolak tanpa menulis", async () => {
    let mocks = setupCloseMocks({ role: "finance" });
    expect(await setClaimDeadlineAction("induk-1", "2026-12-31")).toEqual({
      error: NATIONAL_SKP_MESSAGES.notAdmin,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks({ campaign: { ...OPEN_PARENT, is_national: false } });
    expect(await setClaimDeadlineAction("induk-1", "2026-12-31")).toEqual({
      error: NATIONAL_SKP_MESSAGES.notNational,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks();
    expect(await setClaimDeadlineAction("induk-1", "31/12/2026")).toEqual({
      error: NATIONAL_SKP_MESSAGES.deadlineInvalid,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();
  });
});

describe("closeNationalAction", () => {
  it("admin menutup induk: waktu dan pelaku dicatat, hanya bila masih terbuka & Disetujui", async () => {
    const { campaignsTable, campaignWrite } = setupCloseMocks();

    expect(await closeNationalAction("induk-1")).toEqual({ success: true, completed: false });
    expect(campaignsTable.update).toHaveBeenCalledWith({
      national_closed_at: expect.any(String),
      national_closed_by: "admin-1",
    });
    expect(campaignWrite.eq).toHaveBeenCalledWith("id", "induk-1");
    expect(campaignWrite.eq).toHaveBeenCalledWith("is_national", true);
    expect(campaignWrite.eq).toHaveBeenCalledWith("status", "approved");
    expect(campaignWrite.is).toHaveBeenCalledWith("national_closed_at", null);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/induk-1");
  });

  it("melaporkan induk yang langsung Selesai karena tidak ada klaim berjalan", async () => {
    setupCloseMocks({ updatedRows: [{ id: "induk-1", status: "completed" }] });
    expect(await closeNationalAction("induk-1")).toEqual({ success: true, completed: true });
  });

  it("role lain, sudah ditutup, dan bukan Disetujui ditolak tanpa menulis", async () => {
    let mocks = setupCloseMocks({ role: "finance" });
    expect(await closeNationalAction("induk-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notAdmin });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks({
      campaign: { ...OPEN_PARENT, national_closed_at: "2026-11-20T03:00:00Z" },
    });
    expect(await closeNationalAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.alreadyClosed,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks({ campaign: { ...OPEN_PARENT, status: "draft" } });
    expect(await closeNationalAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.closeNotApproved,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();
  });

  it("SKP tidak ditemukan dan perubahan bersamaan", async () => {
    setupCloseMocks({ campaign: null });
    expect(await closeNationalAction("induk-1")).toEqual({ error: "SKP tidak ditemukan" });

    setupCloseMocks({ updatedRows: [] });
    expect(await closeNationalAction("induk-1")).toEqual({
      error: "SKP sudah berubah — muat ulang halaman lalu coba lagi",
    });
  });
});

describe("reopenNationalAction", () => {
  const CLOSED = { ...OPEN_PARENT, national_closed_at: "2026-11-20T03:00:00Z" };

  it("admin membuka kembali induk tertutup yang belum Selesai", async () => {
    const { campaignsTable, campaignWrite } = setupCloseMocks({ campaign: CLOSED });

    expect(await reopenNationalAction("induk-1")).toEqual({ success: true });
    expect(campaignsTable.update).toHaveBeenCalledWith({
      national_closed_at: null,
      national_closed_by: null,
    });
    expect(campaignWrite.eq).toHaveBeenCalledWith("id", "induk-1");
    expect(campaignWrite.eq).toHaveBeenCalledWith("is_national", true);
    expect(campaignWrite.neq).toHaveBeenCalledWith("status", "completed");
    expect(campaignWrite.not).toHaveBeenCalledWith("national_closed_at", "is", null);
  });

  it("role lain, belum ditutup, dan sudah Selesai ditolak tanpa menulis", async () => {
    let mocks = setupCloseMocks({ role: "manager", campaign: CLOSED });
    expect(await reopenNationalAction("induk-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notAdmin });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks();
    expect(await reopenNationalAction("induk-1")).toEqual({ error: NATIONAL_SKP_MESSAGES.notClosed });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();

    mocks = setupCloseMocks({ campaign: { ...CLOSED, status: "completed" } });
    expect(await reopenNationalAction("induk-1")).toEqual({
      error: NATIONAL_SKP_MESSAGES.reopenCompleted,
    });
    expect(mocks.campaignsTable.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// Alih kepemilikan klaim turunan (Fase 8)
// ============================================================

import { transferChildOwnerAction } from "./national-skp";

type TransferChild = Child & { distributor_id: string | null };

const TRANSFER_CHILD: TransferChild = {
  id: "turunan-1",
  status: "claim_submitted",
  parent_campaign_id: "induk-1",
  claim_owner_id: "dist-1",
  distributor_id: "perusahaan-1",
};

const NEW_OWNER = {
  id: "dist-2",
  role: "distributor",
  is_active: true,
  distributor_id: "perusahaan-1",
};

function setupTransferMocks({
  role = "admin",
  isActive = true,
  child = TRANSFER_CHILD as TransferChild | null,
  candidate = NEW_OWNER as typeof NEW_OWNER | null,
  candidateOpenClaims = 0,
  rpcResult = { data: null, error: null } as {
    data: null;
    error: { message: string; code?: string } | null;
  },
} = {}) {
  let usersCall = 0;
  const openClaimsCount = chain({ count: candidateOpenClaims, error: null });
  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") {
        // Panggilan pertama = profil pelaku, kedua = akun tujuan.
        usersCall += 1;
        return usersCall === 1
          ? chain({ data: { role, is_active: isActive } })
          : chain({ data: candidate });
      }
      if (table === "campaigns") {
        return {
          select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) =>
            opts?.head ? openClaimsCount : chain({ data: child })
          ),
        };
      }
      throw new Error(`tabel tak terduga: ${table}`);
    }),
  };
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
  return { rpc, openClaimsCount };
}

describe("transferChildOwnerAction", () => {
  it("admin mengalihkan kepemilikan lewat fungsi database, dikunci ke pemilik lama", async () => {
    const { rpc, openClaimsCount } = setupTransferMocks();

    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({ success: true });

    expect(rpc).toHaveBeenCalledWith("transfer_national_child_owner", {
      p_child_id: "turunan-1",
      p_actor_id: "admin-1",
      p_new_owner_id: "dist-2",
      p_expected_owner_id: "dist-1",
    });
    // Klaim terbuka akun tujuan dihitung atas induk yang sama.
    expect(openClaimsCount.eq).toHaveBeenCalledWith("parent_campaign_id", "induk-1");
    expect(openClaimsCount.eq).toHaveBeenCalledWith("claim_owner_id", "dist-2");
    expect(openClaimsCount.in).toHaveBeenCalledWith("status", ["approved", "ongoing"]);
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/turunan-1");
    expect(revalidatePath).toHaveBeenCalledWith("/campaigns/induk-1");
  });

  it("berlaku pada status apa pun", async () => {
    for (const status of [
      "approved",
      "ongoing",
      "claim_verified",
      "ready_to_pay",
      "paid",
      "completed",
      "cancelled",
    ]) {
      const { rpc } = setupTransferMocks({ child: { ...TRANSFER_CHILD, status } });
      expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({ success: true });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("role selain admin/superadmin dan akun nonaktif ditolak tanpa menulis", async () => {
    for (const role of ["distributor", "finance", "manager", "user"]) {
      const { rpc } = setupTransferMocks({ role });
      expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
        error: NATIONAL_SKP_MESSAGES.transferNotAdmin,
      });
      expect(rpc).not.toHaveBeenCalled();
    }
    const { rpc } = setupTransferMocks({ isActive: false });
    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
      error: "Akun tidak aktif",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("klaim tidak ditemukan dan SKP biasa ditolak", async () => {
    setupTransferMocks({ child: null });
    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
      error: "Klaim tidak ditemukan",
    });

    const { rpc } = setupTransferMocks({
      child: { ...TRANSFER_CHILD, parent_campaign_id: null, claim_owner_id: null },
    });
    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
      error: NATIONAL_SKP_MESSAGES.transferNotChild,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("akun tujuan yang tidak sah ditolak tanpa menulis", async () => {
    const m = NATIONAL_SKP_MESSAGES;
    const cases: [typeof NEW_OWNER | null, string][] = [
      [null, m.transferCandidateNotFound],
      [{ ...NEW_OWNER, role: "finance" }, m.transferCandidateNotDistributor],
      [{ ...NEW_OWNER, is_active: false }, m.transferCandidateInactive],
      [{ ...NEW_OWNER, distributor_id: "perusahaan-2" }, m.transferCandidateOtherCompany],
      [{ ...NEW_OWNER, id: "dist-1" }, m.transferSameOwner],
    ];
    for (const [candidate, message] of cases) {
      const { rpc } = setupTransferMocks({ candidate });
      expect(await transferChildOwnerAction("turunan-1", candidate?.id ?? "dist-x")).toEqual({
        error: message,
      });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("ditolak bila akun tujuan masih punya klaim yang belum diajukan atas induk yang sama", async () => {
    const { rpc } = setupTransferMocks({ candidateOpenClaims: 1 });
    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
      error: NATIONAL_SKP_MESSAGES.transferCandidateHasOpenClaim,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("penolakan database diteruskan sebagai pesan ramah; error teknis tidak bocor", async () => {
    setupTransferMocks({
      rpcResult: {
        data: null,
        error: { code: "P0001", message: NATIONAL_SKP_MESSAGES.transferCandidateHasOpenClaim },
      },
    });
    expect(await transferChildOwnerAction("turunan-1", "dist-2")).toEqual({
      error: NATIONAL_SKP_MESSAGES.transferCandidateHasOpenClaim,
    });

    setupTransferMocks({
      rpcResult: { data: null, error: { code: "42883", message: "function does not exist" } },
    });
    expect((await transferChildOwnerAction("turunan-1", "dist-2")).error).toBe(
      "Kepemilikan klaim gagal dialihkan — coba lagi sebentar lagi"
    );
  });
});

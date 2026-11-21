import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/claim-checklist-sync", () => ({
  syncChecklistAfterFileDelete: vi.fn(),
}));
vi.mock("@/lib/claim-document-uploaders-data", () => ({
  fetchAppointedUploadersByDocType: vi.fn(),
}));

import { DELETE, POST } from "./route";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { syncChecklistAfterFileDelete } from "@/lib/claim-checklist-sync";
import { fetchAppointedUploadersByDocType } from "@/lib/claim-document-uploaders-data";

function makeSelectChain(result: { data: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

function setupMocks(
  fileRecord: unknown,
  campaign: {
    status: string;
    claim_submitted_by?: string | null;
    distributor_id?: string | null;
  } | null = { status: "ongoing" },
  opts: {
    role?: string;
    appointed?: { id: string; role: string; is_active: boolean; distributor_id: string | null }[];
    verificationItem?: { id: string; status: string } | null;
  } = {}
) {
  const filesChain = makeSelectChain({ data: fileRecord });
  // Baris claim_item_verifications dokumen itu — hanya dibaca untuk item
  // terkunci saat Klaim Diajukan (Fase 4).
  const verificationChain = makeSelectChain({ data: null });
  verificationChain.maybeSingle = vi.fn().mockResolvedValue({ data: opts.verificationItem ?? null });
  const campaignsChain = makeSelectChain({ data: campaign });
  const usersChain = makeSelectChain({ data: { role: opts.role ?? "distributor" } });
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "dist-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "campaign_files") return filesChain;
      if (table === "campaigns") return campaignsChain;
      if (table === "users") return usersChain;
      if (table === "claim_item_verifications") return verificationChain;
      return filesChain;
    }),
  };

  const storageRemove = vi.fn().mockResolvedValue({});
  const adminClient = { storage: { from: vi.fn().mockReturnValue({ remove: storageRemove }) } };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);
  (syncChecklistAfterFileDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (fetchAppointedUploadersByDocType as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Map(opts.appointed?.length ? [["doc-1", opts.appointed]] : [])
  );

  return { supabase, adminClient, filesChain, campaignsChain, storageRemove };
}

function makeRequest(fileId: string | null) {
  return {
    json: async () => ({ fileId }),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/upload", () => {
  it("rejects files over 4.4 MB (below Vercel's 4.5 MB request limit)", async () => {
    const usersChain = makeSelectChain({ data: { is_active: true } });
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockReturnValue(usersChain),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    const file = { name: "skp.pdf", type: "application/pdf", size: 4_400_001 };
    const request = {
      formData: async () => ({
        get: (key: string) => ({ file, campaign_id: "camp-1" })[key] ?? null,
      }),
    } as unknown as NextRequest;

    const res = await POST(request);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/4,4 MB/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/upload", () => {
  it("removes a claim document and syncs the checklist item afterwards", async () => {
    setupMocks({
      file_url: "path/to/file.jpg",
      uploaded_by: "dist-1",
      campaign_id: "camp-1",
      document_type_id: "doc-1",
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(syncChecklistAfterFileDelete).toHaveBeenCalledWith(expect.anything(), {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });
  });

  it("does not touch the checklist when deleting a plain SKP attachment (no document_type_id)", async () => {
    setupMocks({
      file_url: "path/to/file.pdf",
      uploaded_by: "dist-1",
      campaign_id: "camp-1",
      document_type_id: null,
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("rejects deleting a file uploaded by someone else", async () => {
    setupMocks({
      file_url: "path/to/file.jpg",
      uploaded_by: "someone-else",
      campaign_id: "camp-1",
      document_type_id: "doc-1",
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(403);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("rejects deleting a claim document once the claim has been submitted (locked)", async () => {
    setupMocks(
      {
        file_url: "path/to/file.jpg",
        uploaded_by: "dist-1",
        campaign_id: "camp-1",
        document_type_id: "doc-1",
      },
      { status: "claim_submitted", claim_submitted_by: "dist-1" }
    );

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Approved|Ongoing/i);
    expect(syncChecklistAfterFileDelete).not.toHaveBeenCalled();
  });

  it("allows deleting a plain SKP attachment even when the campaign is claim_submitted", async () => {
    setupMocks(
      {
        file_url: "path/to/file.pdf",
        uploaded_by: "dist-1",
        campaign_id: "camp-1",
        document_type_id: null,
      },
      { status: "claim_submitted", claim_submitted_by: "dist-1" }
    );

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
  });

  // Fase 9 — pemegang klaim
  it("rejects deleting a colleague's claim document with a clear message (pengunggah saja)", async () => {
    setupMocks({
      file_url: "path/to/file.jpg",
      uploaded_by: "dist-2",
      campaign_id: "camp-1",
      document_type_id: "doc-1",
    });

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/pengunggah/i);
  });

  it("rejects an uploader who is not the claim holder once the claim is submitted", async () => {
    const { storageRemove } = setupMocks(
      {
        file_url: "path/to/file.jpg",
        uploaded_by: "dist-1",
        campaign_id: "camp-1",
        document_type_id: "doc-1",
      },
      { status: "claim_submitted", claim_submitted_by: "dist-2" }
    );

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/pemegang klaim/i);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/upload — item terkunci (Pengunggah Khusus Fase 2)", () => {
  const meriana = { id: "meriana", role: "distributor", is_active: true, distributor_id: "company-a" };
  const otherFile = {
    file_url: "path/to/file.jpg",
    uploaded_by: "meriana",
    campaign_id: "camp-1",
    document_type_id: "doc-1",
  };
  const ownFile = { ...otherFile, uploaded_by: "dist-1" };
  const skp = { status: "ongoing", distributor_id: "company-a" };

  it("mengizinkan admin menghapus file item terkunci milik akun lain, checklist disinkronkan lewat klien sistem", async () => {
    const { adminClient, storageRemove } = setupMocks(otherFile, skp, {
      role: "admin",
      appointed: [meriana],
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(storageRemove).toHaveBeenCalled();
    expect(syncChecklistAfterFileDelete).toHaveBeenCalledWith(adminClient, {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });
  });

  it("tetap menolak admin menghapus file akun lain pada item yang tidak terkunci", async () => {
    const { storageRemove } = setupMocks(otherFile, skp, { role: "admin" });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(403);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("menolak akun cabang menghapus file pengunggah khusus", async () => {
    const { storageRemove } = setupMocks(otherFile, skp, { appointed: [meriana] });

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/pengunggah/i);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("pengunggah khusus menghapus filenya sendiri dan checklist ikut disinkronkan", async () => {
    const { supabase } = setupMocks(ownFile, skp, { appointed: [{ ...meriana, id: "dist-1" }] });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(syncChecklistAfterFileDelete).toHaveBeenCalledWith(supabase, expect.anything());
  });

  it("file lama unggahan cabang pada item terkunci tetap bisa dihapus pengunggahnya (aturan lama)", async () => {
    setupMocks(ownFile, skp, { appointed: [meriana] });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
  });

  it("admin tetap terikat jendela status saat menghapus item terkunci", async () => {
    setupMocks(otherFile, { status: "paid", distributor_id: "company-a" }, {
      role: "admin",
      appointed: [meriana],
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/upload — jangkauan lintas perusahaan (Pengunggah Khusus Fase 3)", () => {
  // "dist-1" = pengunggah khusus dari perusahaan induk; SKP milik anak
  // perusahaan, yang selebihnya hanya bisa ia lihat. Hapus file tidak pernah
  // menuntut hak bertindak atas SKP — cukup pengunggahnya sendiri.
  const pengunggah = { id: "dist-1", role: "distributor", is_active: true, distributor_id: "induk" };
  const ownFile = {
    file_url: "path/to/surat.pdf",
    uploaded_by: "dist-1",
    campaign_id: "camp-1",
    document_type_id: "doc-1",
  };
  const skpAnak = { status: "ongoing", distributor_id: "anak", distributor: { parent_distributor_id: "induk" } };

  it("pengunggah khusus menghapus filenya di SKP anak perusahaan; checklist disinkronkan atas namanya", async () => {
    const { supabase, storageRemove } = setupMocks(ownFile, skpAnak, { appointed: [pengunggah] });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(200);
    expect(storageRemove).toHaveBeenCalled();
    expect(syncChecklistAfterFileDelete).toHaveBeenCalledWith(supabase, {
      campaignId: "camp-1",
      actorId: "dist-1",
      documentTypeId: "doc-1",
    });
  });

  it("menolak hapus di klaim turunan yang sudah dibatalkan", async () => {
    const { storageRemove } = setupMocks(ownFile, { ...skpAnak, status: "cancelled" }, {
      appointed: [pengunggah],
    });

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(400);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/upload — sesudah klaim diajukan (Pengunggah Khusus Fase 4)", () => {
  // "dist-1" = pengunggah khusus; klaim dipegang akun cabang ("cabang-1").
  const pengunggah = { id: "dist-1", role: "distributor", is_active: true, distributor_id: "company-a" };
  const ownFile = {
    file_url: "path/to/surat.pdf",
    uploaded_by: "dist-1",
    campaign_id: "camp-1",
    document_type_id: "doc-1",
  };
  const diajukan = { status: "claim_submitted", claim_submitted_by: "cabang-1", distributor_id: "company-a" };

  it("pengunggah khusus (bukan pemegang klaim) menghapus filenya selama item belum Accept", async () => {
    for (const itemStatus of ["pending", "revision_requested", null]) {
      const { storageRemove } = setupMocks(ownFile, diajukan, {
        appointed: [pengunggah],
        verificationItem: itemStatus ? { id: "item-1", status: itemStatus } : null,
      });

      const res = await DELETE(makeRequest("file-1"));

      expect(res.status).toBe(200);
      expect(storageRemove).toHaveBeenCalled();
      expect(syncChecklistAfterFileDelete).toHaveBeenCalled();
    }
  });

  it("menolak hapus setelah Finance Accept, dengan pesan jelas", async () => {
    const { storageRemove } = setupMocks(ownFile, diajukan, {
      appointed: [pengunggah],
      verificationItem: { id: "item-1", status: "accepted" },
    });

    const res = await DELETE(makeRequest("file-1"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Accept/);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("menolak hapus pada status sesudah Klaim Diajukan", async () => {
    for (const status of ["claim_verified", "ready_to_pay", "paid", "completed"]) {
      const { storageRemove } = setupMocks(ownFile, { ...diajukan, status }, { appointed: [pengunggah] });

      const res = await DELETE(makeRequest("file-1"));

      expect(res.status).toBe(400);
      expect(storageRemove).not.toHaveBeenCalled();
    }
  });

  it("admin menghapus file item terkunci sesudah klaim diajukan selama belum Accept", async () => {
    const fileMeriana = { ...ownFile, uploaded_by: "meriana" };
    const appointed = [{ ...pengunggah, id: "meriana" }];

    setupMocks(fileMeriana, diajukan, {
      role: "admin",
      appointed,
      verificationItem: { id: "item-1", status: "pending" },
    });
    expect((await DELETE(makeRequest("file-1"))).status).toBe(200);

    setupMocks(fileMeriana, diajukan, {
      role: "admin",
      appointed,
      verificationItem: { id: "item-1", status: "accepted" },
    });
    expect((await DELETE(makeRequest("file-1"))).status).toBe(400);
  });

  it("file lama unggahan cabang pada item terkunci mengikuti aturan hapus lama (terkunci sesudah submit)", async () => {
    // "dist-1" = cabang pemegang klaim, bukan pengunggah khusus
    const { storageRemove } = setupMocks(
      ownFile,
      { ...diajukan, claim_submitted_by: "dist-1" },
      { appointed: [{ ...pengunggah, id: "meriana" }], verificationItem: { id: "item-1", status: "pending" } }
    );

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(400);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("regresi: item tidak terkunci tetap tidak bisa dihapus sesudah klaim diajukan", async () => {
    const { storageRemove } = setupMocks(
      ownFile,
      { ...diajukan, claim_submitted_by: "dist-1" },
      { verificationItem: { id: "item-1", status: "revision_requested" } }
    );

    const res = await DELETE(makeRequest("file-1"));

    expect(res.status).toBe(400);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});

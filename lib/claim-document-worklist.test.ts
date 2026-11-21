import { describe, it, expect } from "vitest";
import {
  computeSpecialUploaderWorklist,
  sortBySpecialUploaderWorklist,
  specialUploaderWorklistLabel,
  specialUploaderWorklistPriority,
  type WorklistCampaign,
} from "./claim-document-worklist";
import type { AppointedUploader } from "./claim-document-uploaders";

const EDM = "edm";
const MMS = "mms"; // anak perusahaan EDM
const OTHER = "other";
const SURAT = "dt-surat";
const FAKTUR = "dt-faktur";
const CAT = "cat-1";

function uploader(overrides: Partial<AppointedUploader> = {}): AppointedUploader {
  return { id: "meriana", role: "distributor", is_active: true, distributor_id: EDM, ...overrides };
}

function campaign(overrides: Partial<WorklistCampaign> = {}): WorklistCampaign {
  return {
    id: "c-1",
    status: "approved",
    is_national: false,
    parent_campaign_id: null,
    distributor_id: EDM,
    distributor_parent_id: null,
    promotion_category_id: CAT,
    ...overrides,
  };
}

const appointed = new Map([[SURAT, [uploader()]]]);
const requirements = [{ promotion_category_id: CAT, document_type_id: SURAT }];

function worklist(overrides: Partial<Parameters<typeof computeSpecialUploaderWorklist>[0]> = {}) {
  return computeSpecialUploaderWorklist({
    actorId: "meriana",
    campaigns: [campaign()],
    appointedByDocType: appointed,
    requirements,
    files: [],
    itemVerifications: [],
    ...overrides,
  });
}

describe("specialUploaderWorklistPriority", () => {
  const base = { is_national: false, parent_campaign_id: null };

  it("Disetujui / Berjalan tanpa file → prioritas 3; dengan file → tidak masuk", () => {
    for (const status of ["approved", "ongoing"]) {
      expect(specialUploaderWorklistPriority({ ...base, status }, false, null)).toBe(3);
      expect(specialUploaderWorklistPriority({ ...base, status }, true, null)).toBeNull();
    }
  });

  it("Klaim Diajukan tanpa file → prioritas 2", () => {
    const c = { ...base, status: "claim_submitted" };
    expect(specialUploaderWorklistPriority(c, false, "pending")).toBe(2);
    expect(specialUploaderWorklistPriority(c, false, null)).toBe(2);
    expect(specialUploaderWorklistPriority(c, true, "pending")).toBeNull();
  });

  it("diminta revisi → prioritas 1, ada file atau tidak", () => {
    const c = { ...base, status: "claim_submitted" };
    expect(specialUploaderWorklistPriority(c, true, "revision_requested")).toBe(1);
    expect(specialUploaderWorklistPriority(c, false, "revision_requested")).toBe(1);
  });

  it("item yang sudah Accept tidak pernah masuk", () => {
    expect(
      specialUploaderWorklistPriority({ ...base, status: "claim_submitted" }, false, "accepted")
    ).toBeNull();
  });

  it("status di luar jendela tidak masuk", () => {
    for (const status of ["draft", "claim_verified", "ready_to_pay", "paid", "completed", "cancelled"]) {
      expect(specialUploaderWorklistPriority({ ...base, status }, false, null)).toBeNull();
    }
  });

  it("SKP induk nasional tidak pernah masuk; klaim turunan aktif masuk", () => {
    expect(
      specialUploaderWorklistPriority(
        { status: "approved", is_national: true, parent_campaign_id: null },
        false,
        null
      )
    ).toBeNull();
    expect(
      specialUploaderWorklistPriority(
        { status: "approved", is_national: false, parent_campaign_id: "p" },
        false,
        null
      )
    ).toBe(3);
    expect(
      specialUploaderWorklistPriority(
        { status: "cancelled", is_national: false, parent_campaign_id: "p" },
        false,
        null
      )
    ).toBeNull();
  });
});

describe("computeSpecialUploaderWorklist", () => {
  it("memuat SKP perusahaan sendiri yang belum ada filenya", () => {
    expect(worklist()).toEqual({ "c-1": 3 });
  });

  it("memuat SKP anak perusahaan, bukan perusahaan di luar grup", () => {
    expect(
      worklist({
        campaigns: [
          campaign({ id: "anak", distributor_id: MMS, distributor_parent_id: EDM }),
          campaign({ id: "luar", distributor_id: OTHER }),
        ],
      })
    ).toEqual({ anak: 3 });
  });

  it("SKP hilang setelah filenya ada, muncul lagi saat diminta revisi", () => {
    const files = [{ campaign_id: "c-1", document_type_id: SURAT }];
    expect(worklist({ files })).toEqual({});
    expect(
      worklist({
        campaigns: [campaign({ status: "claim_submitted" })],
        files,
        itemVerifications: [
          { campaign_id: "c-1", document_type_id: SURAT, status: "revision_requested" },
        ],
      })
    ).toEqual({ "c-1": 1 });
  });

  it("file jenis dokumen lain tidak dihitung", () => {
    expect(worklist({ files: [{ campaign_id: "c-1", document_type_id: FAKTUR }] })).toEqual({
      "c-1": 3,
    });
  });

  it("jenis dokumen yang tidak wajib untuk kategori SKP tidak masuk", () => {
    expect(worklist({ requirements: [] })).toEqual({});
    expect(worklist({ campaigns: [campaign({ promotion_category_id: null })] })).toEqual({});
  });

  it("akun yang bukan pengunggah khusus efektif tidak punya daftar", () => {
    expect(worklist({ actorId: "cabang" })).toEqual({});
    expect(
      worklist({ appointedByDocType: new Map([[SURAT, [uploader({ is_active: false })]]]) })
    ).toEqual({});
  });

  it("lebih dari satu jenis dokumen → prioritas paling mendesak", () => {
    expect(
      worklist({
        campaigns: [campaign({ status: "claim_submitted" })],
        appointedByDocType: new Map([
          [SURAT, [uploader()]],
          [FAKTUR, [uploader()]],
        ]),
        requirements: [
          { promotion_category_id: CAT, document_type_id: SURAT },
          { promotion_category_id: CAT, document_type_id: FAKTUR },
        ],
        files: [{ campaign_id: "c-1", document_type_id: FAKTUR }],
        itemVerifications: [
          { campaign_id: "c-1", document_type_id: FAKTUR, status: "revision_requested" },
        ],
      })
    ).toEqual({ "c-1": 1 });
  });
});

describe("sortBySpecialUploaderWorklist", () => {
  it("hanya SKP dalam daftar, urut prioritas, urutan asal dipertahankan dalam satu prioritas", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    expect(
      sortBySpecialUploaderWorklist(rows, { a: 3, b: 1, d: 2, e: 3 }).map((r) => r.id)
    ).toEqual(["b", "d", "a", "e"]);
  });
});

describe("specialUploaderWorklistLabel", () => {
  it("memakai nama jenis dokumen bila hanya satu, label umum bila lebih", () => {
    expect(specialUploaderWorklistLabel([])).toBeNull();
    expect(specialUploaderWorklistLabel(["Surat Pengantar Klaim"])).toBe(
      "Menunggu Surat Pengantar Klaim"
    );
    expect(specialUploaderWorklistLabel(["A", "B"])).toBe("Menunggu dokumen saya");
  });
});

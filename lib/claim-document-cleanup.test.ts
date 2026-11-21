import { describe, expect, it } from "vitest";
import { computeLockedChecklistCleanup } from "@/lib/claim-document-cleanup";
import type { AppointedUploader } from "@/lib/claim-document-uploaders";

const EDM = "dist-edm";
const MMS = "dist-mms";
const OTHER = "dist-other";
const DOC = "doc-surat-pengantar";

const meriana: AppointedUploader = {
  id: "user-meriana",
  role: "distributor",
  is_active: true,
  distributor_id: EDM,
};

const appointed = new Map([[DOC, [meriana]]]);

function campaign(over: Partial<Parameters<typeof computeLockedChecklistCleanup>[0]["campaigns"][number]> = {}) {
  return {
    id: "c1",
    status: "approved",
    is_national: false,
    distributor_id: EDM,
    distributor_parent_id: null,
    ...over,
  };
}

const ticked = (campaignId = "c1", documentTypeId = DOC) => ({
  id: `chk-${campaignId}-${documentTypeId}`,
  campaign_id: campaignId,
  document_type_id: documentTypeId,
  is_fulfilled: true,
});

function run(over: Partial<Parameters<typeof computeLockedChecklistCleanup>[0]> = {}) {
  return computeLockedChecklistCleanup({
    campaigns: [campaign()],
    appointedByDocType: appointed,
    checklists: [ticked()],
    files: [],
    itemVerifications: [],
    ...over,
  });
}

describe("computeLockedChecklistCleanup", () => {
  it("melepas centang item terkunci yang tercentang tanpa file", () => {
    expect(run()).toEqual([
      { checklistId: "chk-c1-doc-surat-pengantar", campaignId: "c1", documentTypeId: DOC },
    ]);
  });

  it("tidak menyentuh item yang sudah punya file (termasuk unggahan lama cabang)", () => {
    expect(run({ files: [{ campaign_id: "c1", document_type_id: DOC }] })).toEqual([]);
  });

  it("file jenis dokumen lain atau SKP lain tidak dihitung", () => {
    expect(
      run({
        files: [
          { campaign_id: "c1", document_type_id: "doc-lain" },
          { campaign_id: "c2", document_type_id: DOC },
          { campaign_id: "c1", document_type_id: null },
        ],
      })
    ).toHaveLength(1);
  });

  it("tidak menyentuh centang yang sudah lepas", () => {
    expect(run({ checklists: [{ ...ticked(), is_fulfilled: false }] })).toEqual([]);
  });

  it("tidak menyentuh item tidak terkunci", () => {
    expect(run({ checklists: [ticked("c1", "doc-lain")] })).toEqual([]);
    expect(run({ campaigns: [campaign({ distributor_id: OTHER })] })).toEqual([]);
    expect(
      run({ appointedByDocType: new Map([[DOC, [{ ...meriana, is_active: false }]]]) })
    ).toEqual([]);
  });

  it("mencakup SKP anak perusahaan", () => {
    expect(
      run({ campaigns: [campaign({ distributor_id: MMS, distributor_parent_id: EDM })] })
    ).toHaveLength(1);
  });

  it.each(["approved", "ongoing", "claim_submitted"])("status %s masuk", (status) => {
    expect(run({ campaigns: [campaign({ status })] })).toHaveLength(1);
  });

  it.each([
    "draft",
    "pending_approval",
    "claim_verified",
    "ready_to_pay",
    "paid",
    "completed",
    "cancelled",
    "rejected",
  ])("status %s tidak disentuh", (status) => {
    expect(run({ campaigns: [campaign({ status })] })).toEqual([]);
  });

  it("tidak menyentuh item yang sudah di-Accept Finance", () => {
    const verification = (status: string) => ({
      campaign_id: "c1",
      document_type_id: DOC,
      status,
    });
    const submitted = [campaign({ status: "claim_submitted" })];
    expect(run({ campaigns: submitted, itemVerifications: [verification("accepted")] })).toEqual(
      []
    );
    expect(
      run({ campaigns: submitted, itemVerifications: [verification("pending")] })
    ).toHaveLength(1);
    expect(
      run({ campaigns: submitted, itemVerifications: [verification("revision_requested")] })
    ).toHaveLength(1);
  });

  it("tidak menyentuh SKP induk nasional", () => {
    expect(run({ campaigns: [campaign({ is_national: true })] })).toEqual([]);
  });

  it("mengabaikan centang pada SKP di luar daftar", () => {
    expect(run({ checklists: [ticked("c-tidak-ada")] })).toEqual([]);
  });
});

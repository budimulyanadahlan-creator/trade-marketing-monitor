import { describe, it, expect } from "vitest";
import {
  resolveDistributorRecipientIds,
  type NotificationCandidate,
  type NotificationCampaign,
} from "./distributor-notification-recipients";

const EDM = "edm";
const MMS = "mms";
const BIR = "bir";
const WCJ = "region-wcj";
const EJB = "region-ejb";

function user(
  id: string,
  distributor_id: string | null,
  distributor_scope: "cabang" | "pusat" | null,
  region_id: string | null,
  overrides: Partial<NotificationCandidate> = {}
): NotificationCandidate {
  return { id, role: "distributor", is_active: true, distributor_id, distributor_scope, region_id, ...overrides };
}

const candidates: NotificationCandidate[] = [
  user("edm-cabang-wcj", EDM, "cabang", WCJ),
  user("edm-cabang-wcj-2", EDM, "cabang", WCJ),
  user("edm-cabang-ejb", EDM, "cabang", EJB),
  user("edm-pusat", EDM, "pusat", null),
  user("mms-cabang-wcj", MMS, "cabang", WCJ),
  user("mms-cabang-wcj-2", MMS, "cabang", WCJ),
  user("mms-pusat", MMS, "pusat", null),
  user("bir-cabang-wcj", BIR, "cabang", WCJ),
  user("bir-pusat", BIR, "pusat", null),
];

function sorted(ids: string[]) {
  return [...ids].sort();
}

describe("resolveDistributorRecipientIds — sebelum klaim diajukan", () => {
  it("SKP EDM West & Central Java → Cabang EDM region itu + Pusat EDM, bukan Cabang region lain", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: WCJ,
      claim_submitted_by: null,
    };
    expect(sorted(resolveDistributorRecipientIds(campaign, candidates, "before_claim"))).toEqual(
      sorted(["edm-cabang-wcj", "edm-cabang-wcj-2", "edm-pusat"])
    );
  });

  it("SKP MMS → Cabang MMS region SKP + Pusat MMS + Pusat EDM (induk), bukan Cabang EDM atau BIR", () => {
    const campaign: NotificationCampaign = {
      distributor_id: MMS,
      distributor_parent_id: EDM,
      region_id: WCJ,
      claim_submitted_by: null,
    };
    expect(sorted(resolveDistributorRecipientIds(campaign, candidates, "before_claim"))).toEqual(
      sorted(["mms-cabang-wcj", "mms-cabang-wcj-2", "mms-pusat", "edm-pusat"])
    );
  });

  it("SKP tanpa region → hanya Pusat", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: null,
      claim_submitted_by: null,
    };
    expect(resolveDistributorRecipientIds(campaign, candidates, "before_claim")).toEqual(["edm-pusat"]);
  });
});

describe("resolveDistributorRecipientIds — setelah klaim diajukan", () => {
  it("revisi klaim MMS → pemegang + Pusat MMS + Pusat EDM, tidak ke Cabang MMS lain", () => {
    const campaign: NotificationCampaign = {
      distributor_id: MMS,
      distributor_parent_id: EDM,
      region_id: WCJ,
      claim_submitted_by: "mms-cabang-wcj",
    };
    expect(sorted(resolveDistributorRecipientIds(campaign, candidates, "after_claim"))).toEqual(
      sorted(["mms-cabang-wcj", "mms-pusat", "edm-pusat"])
    );
  });

  it("perusahaan tanpa akun Pusat → pemegang + Pusat induk saja", () => {
    const campaign: NotificationCampaign = {
      distributor_id: MMS,
      distributor_parent_id: EDM,
      region_id: WCJ,
      claim_submitted_by: "mms-cabang-wcj",
    };
    const noMmsPusat = candidates.filter((c) => c.id !== "mms-pusat");
    expect(sorted(resolveDistributorRecipientIds(campaign, noMmsPusat, "after_claim"))).toEqual(
      sorted(["mms-cabang-wcj", "edm-pusat"])
    );
  });

  it("pemegang yang juga Pusat tidak dikirimi dua kali", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: WCJ,
      claim_submitted_by: "edm-pusat",
    };
    expect(resolveDistributorRecipientIds(campaign, candidates, "after_claim")).toEqual(["edm-pusat"]);
  });

  it("klaim tanpa pemegang tercatat → memakai penerima sebelum klaim", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: WCJ,
      claim_submitted_by: null,
    };
    expect(sorted(resolveDistributorRecipientIds(campaign, candidates, "after_claim"))).toEqual(
      sorted(["edm-cabang-wcj", "edm-cabang-wcj-2", "edm-pusat"])
    );
  });

  it("pemegang yang dinonaktifkan tidak dikirimi; Pusat tetap", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: WCJ,
      claim_submitted_by: "edm-cabang-wcj",
    };
    const inactiveHolder = candidates.map((c) =>
      c.id === "edm-cabang-wcj" ? { ...c, is_active: false } : c
    );
    expect(resolveDistributorRecipientIds(campaign, inactiveHolder, "after_claim")).toEqual(["edm-pusat"]);
  });

  it("pemegang yang tidak ada di daftar kandidat tidak dikirimi", () => {
    const campaign: NotificationCampaign = {
      distributor_id: EDM,
      distributor_parent_id: null,
      region_id: WCJ,
      claim_submitted_by: "admin-1",
    };
    expect(resolveDistributorRecipientIds(campaign, candidates, "after_claim")).toEqual(["edm-pusat"]);
  });
});

describe("resolveDistributorRecipientIds — penyaringan umum", () => {
  const campaign: NotificationCampaign = {
    distributor_id: EDM,
    distributor_parent_id: null,
    region_id: WCJ,
    claim_submitted_by: null,
  };

  it("akun nonaktif tidak pernah menerima email", () => {
    const list = candidates.map((c) =>
      c.id === "edm-pusat" || c.id === "edm-cabang-wcj" ? { ...c, is_active: false } : c
    );
    expect(resolveDistributorRecipientIds(campaign, list, "before_claim")).toEqual(["edm-cabang-wcj-2"]);
  });

  it("akun non-distributor diabaikan meskipun punya perusahaan", () => {
    const list = [user("admin-x", EDM, "pusat", null, { role: "admin" }), user("edm-pusat", EDM, "pusat", null)];
    expect(resolveDistributorRecipientIds(campaign, list, "before_claim")).toEqual(["edm-pusat"]);
  });

  it("kandidat ganda (id sama) hanya muncul sekali", () => {
    const list = [...candidates, user("edm-pusat", EDM, "pusat", null)];
    expect(sorted(resolveDistributorRecipientIds(campaign, list, "before_claim"))).toEqual(
      sorted(["edm-cabang-wcj", "edm-cabang-wcj-2", "edm-pusat"])
    );
  });

  it("Cabang perusahaan induk tidak menerima notifikasi SKP anak perusahaan", () => {
    const mmsCampaign: NotificationCampaign = { ...campaign, distributor_id: MMS, distributor_parent_id: EDM };
    const ids = resolveDistributorRecipientIds(mmsCampaign, candidates, "before_claim");
    expect(ids).not.toContain("edm-cabang-wcj");
  });

  it("scope null (akun lama) diperlakukan sebagai Cabang", () => {
    const list = [user("legacy", EDM, null, WCJ), user("legacy-ejb", EDM, null, EJB)];
    expect(resolveDistributorRecipientIds(campaign, list, "before_claim")).toEqual(["legacy"]);
  });

  it("SKP tanpa perusahaan → tidak ada penerima", () => {
    const orphan: NotificationCampaign = { ...campaign, distributor_id: null, claim_submitted_by: "edm-pusat" };
    expect(resolveDistributorRecipientIds(orphan, candidates, "before_claim")).toEqual([]);
    expect(resolveDistributorRecipientIds(orphan, candidates, "after_claim")).toEqual([]);
  });
});

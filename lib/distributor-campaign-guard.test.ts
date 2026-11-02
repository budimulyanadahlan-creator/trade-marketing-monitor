import { describe, it, expect } from "vitest";
import {
  DISTRIBUTOR_GUARD_MESSAGES,
  distributorCampaignAccess,
  distributorActionDenial,
  distributorClaimActionError,
  type DistributorViewer,
  type CampaignAccessTarget,
  CLAIM_HOLDER_MESSAGES,
  claimHolderActionError,
  isClaimHolderLocked,
  claimFileDeleteError,
} from "./distributor-campaign-guard";

// Perusahaan: EDM (induk), MMS & BIR (anak EDM), AJS (berdiri sendiri).
const EDM = "co-edm";
const MMS = "co-mms";
const BIR = "co-bir";
const AJS = "co-ajs";
const WCJ = "region-wcj"; // West & Central Java
const EJB = "region-ejb"; // East Java & Bali
const NATIONAL = "region-national";

function viewer(over: Partial<DistributorViewer> = {}): DistributorViewer {
  return {
    role: "distributor",
    distributor_id: EDM,
    distributor_scope: "cabang",
    region_id: WCJ,
    ...over,
  };
}

function skp(over: Partial<CampaignAccessTarget> = {}): CampaignAccessTarget {
  return { distributor_id: EDM, region_id: WCJ, distributor_parent_id: null, ...over };
}

const cabangEdmWcj = viewer();
const pusatEdm = viewer({ distributor_scope: "pusat", region_id: NATIONAL });
const cabangMmsWcj = viewer({ distributor_id: MMS, region_id: WCJ });
const pusatMms = viewer({ distributor_id: MMS, distributor_scope: "pusat", region_id: null });

const skpEdmWcj = skp();
const skpEdmEjb = skp({ region_id: EJB });
const skpMmsWcj = skp({ distributor_id: MMS, distributor_parent_id: EDM });
const skpBirWcj = skp({ distributor_id: BIR, distributor_parent_id: EDM });
const skpAjsWcj = skp({ distributor_id: AJS });
const skpNoCompanyWcj = skp({ distributor_id: null });
const skpNoCompanyEjb = skp({ distributor_id: null, region_id: EJB });

describe("distributorCampaignAccess — perusahaan sama", () => {
  it("cabang: boleh bertindak di region sendiri", () => {
    expect(distributorCampaignAccess(skpEdmWcj, cabangEdmWcj)).toBe("act");
  });

  it("cabang: tidak melihat SKP perusahaannya di region lain", () => {
    expect(distributorCampaignAccess(skpEdmEjb, cabangEdmWcj)).toBeNull();
  });

  it("cabang tanpa region tidak melihat apa pun", () => {
    expect(distributorCampaignAccess(skpEdmWcj, viewer({ region_id: null }))).toBeNull();
  });

  it("cabang: SKP perusahaannya tanpa region tidak terlihat", () => {
    expect(distributorCampaignAccess(skp({ region_id: null }), cabangEdmWcj)).toBeNull();
  });

  it("pusat: boleh bertindak di semua region", () => {
    expect(distributorCampaignAccess(skpEdmWcj, pusatEdm)).toBe("act");
    expect(distributorCampaignAccess(skpEdmEjb, pusatEdm)).toBe("act");
    expect(distributorCampaignAccess(skp({ region_id: null }), pusatEdm)).toBe("act");
  });

  it("scope null diperlakukan sebagai cabang", () => {
    const legacy = viewer({ distributor_scope: null });
    expect(distributorCampaignAccess(skpEdmWcj, legacy)).toBe("act");
    expect(distributorCampaignAccess(skpEdmEjb, legacy)).toBeNull();
  });
});

describe("distributorCampaignAccess — perusahaan lain & induk", () => {
  it("cabang EDM tidak melihat SKP BIR/MMS di region yang sama", () => {
    expect(distributorCampaignAccess(skpBirWcj, cabangEdmWcj)).toBeNull();
    expect(distributorCampaignAccess(skpMmsWcj, cabangEdmWcj)).toBeNull();
  });

  it("pusat EDM hanya melihat (view) SKP anak perusahaan di semua region", () => {
    expect(distributorCampaignAccess(skpMmsWcj, pusatEdm)).toBe("view");
    expect(distributorCampaignAccess(skp({ distributor_id: BIR, distributor_parent_id: EDM, region_id: EJB }), pusatEdm)).toBe("view");
  });

  it("pusat EDM tidak melihat perusahaan yang bukan anaknya", () => {
    expect(distributorCampaignAccess(skpAjsWcj, pusatEdm)).toBeNull();
  });

  it("MMS/BIR tidak melihat SKP EDM maupun satu sama lain", () => {
    expect(distributorCampaignAccess(skpEdmWcj, cabangMmsWcj)).toBeNull();
    expect(distributorCampaignAccess(skpEdmWcj, pusatMms)).toBeNull();
    expect(distributorCampaignAccess(skpBirWcj, cabangMmsWcj)).toBeNull();
    expect(distributorCampaignAccess(skpBirWcj, pusatMms)).toBeNull();
  });

  it("cabang dari perusahaan induk tidak mendapat hak lihat anak perusahaan", () => {
    expect(distributorCampaignAccess(skpMmsWcj, cabangEdmWcj)).toBeNull();
  });
});

describe("distributorCampaignAccess — SKP tanpa perusahaan (Fase 6: tidak terlihat siapa pun)", () => {
  it("cabang tidak melihat SKP tanpa perusahaan, termasuk di region yang sama", () => {
    expect(distributorCampaignAccess(skpNoCompanyWcj, cabangEdmWcj)).toBeNull();
    expect(distributorCampaignAccess(skpNoCompanyEjb, cabangEdmWcj)).toBeNull();
  });

  it("pusat tidak melihat SKP tanpa perusahaan di region mana pun", () => {
    expect(distributorCampaignAccess(skpNoCompanyWcj, pusatEdm)).toBeNull();
    expect(distributorCampaignAccess(skpNoCompanyEjb, pusatEdm)).toBeNull();
  });

  it("pusat induk pun tidak melihat SKP tanpa perusahaan", () => {
    expect(distributorCampaignAccess(skp({ distributor_id: null, distributor_parent_id: EDM }), pusatEdm)).toBeNull();
  });
});

describe("distributorCampaignAccess — akun tanpa perusahaan & role lain", () => {
  it("akun distributor tanpa perusahaan tidak melihat apa pun", () => {
    const orphan = viewer({ distributor_id: null });
    expect(distributorCampaignAccess(skpEdmWcj, orphan)).toBeNull();
    expect(distributorCampaignAccess(skpNoCompanyWcj, orphan)).toBeNull();
  });

  it("admin/superadmin selalu boleh bertindak", () => {
    expect(distributorCampaignAccess(skpBirWcj, viewer({ role: "admin", distributor_id: null }))).toBe("act");
    expect(distributorCampaignAccess(skpBirWcj, viewer({ role: "superadmin", distributor_id: null }))).toBe("act");
  });
});

describe("distributorActionDenial", () => {
  it("menjelaskan alasan penolakan", () => {
    expect(distributorActionDenial(skpEdmWcj, viewer({ distributor_id: null }))).toBe("noCompany");
    expect(distributorActionDenial(skpAjsWcj, cabangEdmWcj)).toBe("otherCompany");
    expect(distributorActionDenial(skpEdmEjb, cabangEdmWcj)).toBe("otherRegion");
    expect(distributorActionDenial(skpMmsWcj, pusatEdm)).toBe("parentViewOnly");
    expect(distributorActionDenial(skpNoCompanyEjb, cabangEdmWcj)).toBe("otherCompany");
    expect(distributorActionDenial(skpNoCompanyWcj, cabangEdmWcj)).toBe("otherCompany");
    expect(distributorActionDenial(skpNoCompanyWcj, pusatEdm)).toBe("otherCompany");
  });

  it("null jika boleh bertindak", () => {
    expect(distributorActionDenial(skpEdmWcj, cabangEdmWcj)).toBeNull();
    expect(distributorActionDenial(skpMmsWcj, viewer({ role: "admin" }))).toBeNull();
  });
});

describe("distributorClaimActionError", () => {
  it("pesan ramah per alasan", () => {
    expect(distributorClaimActionError(viewer({ distributor_id: null }), skpEdmWcj)).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.noCompany
    );
    expect(distributorClaimActionError(cabangEdmWcj, skpAjsWcj)).toBe(
      "SKP ini bukan milik distributor Anda"
    );
    expect(distributorClaimActionError(cabangEdmWcj, skpEdmEjb)).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.otherRegion
    );
    expect(distributorClaimActionError(pusatEdm, skpMmsWcj)).toBe(
      "Hanya lihat — SKP anak perusahaan"
    );
  });

  it("tanpa info induk SKP, pusat induk ditolak sebagai perusahaan lain", () => {
    expect(distributorClaimActionError(pusatEdm, { distributor_id: MMS, region_id: WCJ })).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.otherCompany
    );
  });

  it("null jika boleh; admin tidak pernah diblokir", () => {
    expect(distributorClaimActionError(cabangEdmWcj, skpEdmWcj)).toBeNull();
    expect(distributorClaimActionError(pusatEdm, skpNoCompanyEjb)).toBe(DISTRIBUTOR_GUARD_MESSAGES.otherCompany);
    expect(distributorClaimActionError(viewer({ role: "admin", distributor_id: null }), skpBirWcj)).toBeNull();
  });
});

// -------------------------------------------------------
// Fase 9 — pemegang klaim
// -------------------------------------------------------

const holderA = { id: "user-a", role: "distributor" };
const colleagueB = { id: "user-b", role: "distributor" };
const admin = { id: "admin-1", role: "admin" };
const superadmin = { id: "sa-1", role: "superadmin" };

const submittedByA = { status: "claim_submitted", claim_submitted_by: "user-a" };
const ongoing = { status: "ongoing", claim_submitted_by: null };
const approved = { status: "approved", claim_submitted_by: null };

describe("claimHolderActionError", () => {
  it("pemegang klaim boleh bertindak selama klaim diajukan", () => {
    expect(claimHolderActionError(holderA, submittedByA)).toBeNull();
  });

  it("rekan yang bukan pemegang ditolak selama klaim diajukan", () => {
    expect(claimHolderActionError(colleagueB, submittedByA)).toBe(
      CLAIM_HOLDER_MESSAGES.notHolder
    );
  });

  it("klaim diajukan tanpa pemegang tercatat: hanya admin yang bisa bertindak", () => {
    const orphan = { status: "claim_submitted", claim_submitted_by: null };
    expect(claimHolderActionError(holderA, orphan)).toBe(CLAIM_HOLDER_MESSAGES.notHolder);
    expect(claimHolderActionError(admin, orphan)).toBeNull();
  });

  it("sebelum klaim diajukan tidak ada pemegang — semua akun boleh", () => {
    expect(claimHolderActionError(colleagueB, ongoing)).toBeNull();
    expect(claimHolderActionError(colleagueB, approved)).toBeNull();
  });

  it("admin/superadmin selalu boleh (fallback)", () => {
    expect(claimHolderActionError(admin, submittedByA)).toBeNull();
    expect(claimHolderActionError(superadmin, submittedByA)).toBeNull();
  });

  it("isClaimHolderLocked = kebalikan boleh bertindak", () => {
    expect(isClaimHolderLocked(colleagueB, submittedByA)).toBe(true);
    expect(isClaimHolderLocked(holderA, submittedByA)).toBe(false);
    expect(isClaimHolderLocked(colleagueB, ongoing)).toBe(false);
  });
});

describe("claimFileDeleteError — pemegang × status × pengunggah", () => {
  const fileByA = { uploaded_by: "user-a" };
  const fileByB = { uploaded_by: "user-b" };

  it("sebelum submit: pengunggah boleh menghapus filenya sendiri", () => {
    expect(claimFileDeleteError(holderA, fileByA, ongoing)).toBeNull();
    expect(claimFileDeleteError(colleagueB, fileByB, approved)).toBeNull();
  });

  it("sebelum submit: rekan tidak bisa menghapus file milik orang lain", () => {
    expect(claimFileDeleteError(colleagueB, fileByA, ongoing)).toBe(
      CLAIM_HOLDER_MESSAGES.notUploader
    );
  });

  it("setelah submit: pengunggah yang juga pemegang boleh", () => {
    expect(claimFileDeleteError(holderA, fileByA, submittedByA)).toBeNull();
  });

  it("setelah submit: pengunggah yang bukan pemegang ditolak", () => {
    expect(claimFileDeleteError(colleagueB, fileByB, submittedByA)).toBe(
      CLAIM_HOLDER_MESSAGES.notHolder
    );
  });

  it("setelah submit: pemegang tetap tidak bisa menghapus file milik rekan", () => {
    expect(claimFileDeleteError(holderA, fileByB, submittedByA)).toBe(
      CLAIM_HOLDER_MESSAGES.notUploader
    );
  });

  it("admin pun hanya bisa menghapus file yang diunggahnya sendiri", () => {
    expect(claimFileDeleteError(admin, fileByA, ongoing)).toBe(CLAIM_HOLDER_MESSAGES.notUploader);
    expect(claimFileDeleteError(admin, { uploaded_by: "admin-1" }, submittedByA)).toBeNull();
  });
});

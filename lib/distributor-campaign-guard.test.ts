import { describe, it, expect } from "vitest";
import {
  DISTRIBUTOR_GUARD_MESSAGES,
  distributorCampaignAccess,
  distributorActionDenial,
  distributorClaimActionError,
  type DistributorViewer,
  type CampaignAccessTarget,
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

describe("distributorCampaignAccess — SKP tanpa perusahaan (sementara, sampai Fase 6)", () => {
  it("cabang melihat & bertindak hanya di region yang sama", () => {
    expect(distributorCampaignAccess(skpNoCompanyWcj, cabangEdmWcj)).toBe("act");
    expect(distributorCampaignAccess(skpNoCompanyEjb, cabangEdmWcj)).toBeNull();
  });

  it("pusat melihat & bertindak di semua region", () => {
    expect(distributorCampaignAccess(skpNoCompanyEjb, pusatEdm)).toBe("act");
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
    expect(distributorActionDenial(skpNoCompanyEjb, cabangEdmWcj)).toBe("otherRegion");
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
    expect(distributorClaimActionError(pusatEdm, skpNoCompanyEjb)).toBeNull();
    expect(distributorClaimActionError(viewer({ role: "admin", distributor_id: null }), skpBirWcj)).toBeNull();
  });
});

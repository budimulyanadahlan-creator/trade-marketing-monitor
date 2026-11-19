import { describe, it, expect } from "vitest";
import {
  NATIONAL_SKP_MESSAGES,
  makeNationalError,
  type MakeNationalActivity,
  type MakeNationalTarget,
} from "./national-skp";

const admin = { role: "admin" };
const superadmin = { role: "superadmin" };

function skp(over: Partial<MakeNationalTarget> = {}): MakeNationalTarget {
  return {
    status: "approved",
    is_national: false,
    departmentName: "Sales",
    claim_amount: null,
    claim_submitted_by: null,
    ...over,
  };
}

function activity(over: Partial<MakeNationalActivity> = {}): MakeNationalActivity {
  return {
    realizations: 0,
    fulfilledChecklistItems: 0,
    claimDocuments: 0,
    receipts: 0,
    claimEvents: 0,
    ...over,
  };
}

describe("makeNationalError — syarat Jadikan Nasional", () => {
  it("admin dan superadmin boleh pada SKP Disetujui tanpa aktivitas klaim", () => {
    expect(makeNationalError(admin, skp(), activity())).toBeNull();
    expect(makeNationalError(superadmin, skp({ departmentName: "Trade Marketing" }), activity())).toBeNull();
  });

  it("role lain ditolak", () => {
    for (const role of ["user", "manager", "finance", "distributor"]) {
      expect(makeNationalError({ role }, skp(), activity())).toBe(NATIONAL_SKP_MESSAGES.notAdmin);
    }
  });

  it("hanya SKP berstatus Disetujui", () => {
    for (const status of ["draft", "submitted", "approved_l1", "ongoing", "claim_submitted", "paid", "completed", "rejected", "cancelled"]) {
      expect(makeNationalError(admin, skp({ status }), activity())).toBe(NATIONAL_SKP_MESSAGES.notApproved);
    }
  });

  it("SKP yang sudah nasional ditolak", () => {
    expect(makeNationalError(admin, skp({ is_national: true }), activity())).toBe(
      NATIONAL_SKP_MESSAGES.alreadyNational
    );
  });

  it("hanya departemen Sales / Trade Marketing (selain itu tidak terlihat distributor)", () => {
    expect(makeNationalError(admin, skp({ departmentName: "Marketing" }), activity())).toBe(
      NATIONAL_SKP_MESSAGES.departmentNotVisible
    );
    expect(makeNationalError(admin, skp({ departmentName: null }), activity())).toBe(
      NATIONAL_SKP_MESSAGES.departmentNotVisible
    );
  });

  it("penolakan karena aktivitas klaim menyebut penyebabnya", () => {
    expect(makeNationalError(admin, skp(), activity({ realizations: 2 }))).toBe(
      "SKP tidak dapat dijadikan Nasional karena sudah punya realisasi. Bereskan dulu, lalu coba lagi."
    );
    expect(makeNationalError(admin, skp(), activity({ receipts: 1 }))).toContain("tanda terima");
    expect(makeNationalError(admin, skp(), activity({ claimDocuments: 1 }))).toContain("dokumen klaim");
    expect(makeNationalError(admin, skp(), activity({ fulfilledChecklistItems: 3 }))).toContain(
      "checklist terisi"
    );
  });

  it("klaim terdeteksi dari nominal, pemegang, atau riwayat klaim", () => {
    expect(makeNationalError(admin, skp({ claim_amount: 1000 }), activity())).toContain("klaim");
    expect(makeNationalError(admin, skp({ claim_submitted_by: "user-a" }), activity())).toContain("klaim");
    expect(makeNationalError(admin, skp(), activity({ claimEvents: 1 }))).toContain("klaim");
  });

  it("beberapa penyebab disebut sekaligus", () => {
    expect(
      makeNationalError(
        admin,
        skp({ claim_amount: 500 }),
        activity({ realizations: 1, receipts: 1, claimDocuments: 2, fulfilledChecklistItems: 1 })
      )
    ).toBe(
      "SKP tidak dapat dijadikan Nasional karena sudah punya klaim, checklist terisi, dokumen klaim, tanda terima, realisasi. Bereskan dulu, lalu coba lagi."
    );
  });
});

import { unmakeNationalError, nationalParentActivityError, isNationalParent } from "./national-skp";

describe("unmakeNationalError — syarat Batalkan Nasional", () => {
  const induk = { is_national: true };

  it("admin/superadmin boleh selama belum ada klaim turunan", () => {
    expect(unmakeNationalError(admin, induk, 0)).toBeNull();
    expect(unmakeNationalError(superadmin, induk, 0)).toBeNull();
  });

  it("ditolak bila sudah ada klaim turunan, termasuk yang dibatalkan", () => {
    expect(unmakeNationalError(admin, induk, 1)).toBe(NATIONAL_SKP_MESSAGES.hasChildClaims);
  });

  it("role lain dan SKP bukan nasional ditolak", () => {
    expect(unmakeNationalError({ role: "finance" }, induk, 0)).toBe(NATIONAL_SKP_MESSAGES.notAdmin);
    expect(unmakeNationalError(admin, { is_national: false }, 0)).toBe(NATIONAL_SKP_MESSAGES.notNational);
  });
});

describe("nationalParentActivityError — induk menolak aktivitas klaim", () => {
  it("menolak pada induk nasional, untuk siapa pun pemanggilnya", () => {
    expect(nationalParentActivityError({ is_national: true })).toBe(NATIONAL_SKP_MESSAGES.parentActivity);
  });

  it("null untuk SKP biasa dan baris lama tanpa kolom", () => {
    expect(nationalParentActivityError({ is_national: false })).toBeNull();
    expect(nationalParentActivityError({})).toBeNull();
    expect(nationalParentActivityError({ is_national: null })).toBeNull();
  });

  it("isNationalParent", () => {
    expect(isNationalParent({ is_national: true })).toBe(true);
    expect(isNationalParent({ is_national: false })).toBe(false);
    expect(isNationalParent(null)).toBe(false);
  });
});

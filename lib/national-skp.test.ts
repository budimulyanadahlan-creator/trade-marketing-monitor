import { describe, it, expect } from "vitest";
import {
  NATIONAL_SKP_MESSAGES,
  makeNationalError,
  type MakeNationalActivity,
  type MakeNationalTarget,
} from "./national-skp";
import {
  OPEN_CHILD_CLAIM_STATUSES,
  cancelChildClaimError,
  isOpenChildClaimStatus,
  type CancelChildClaimTarget,
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

// ============================================================
// Fase 2: klaim turunan
// ============================================================

import {
  childClaimName,
  childSkpNumber,
  createChildClaimError,
  isNationalChild,
  nationalReceiptError,
  type ChildClaimActor,
  type ChildClaimParent,
} from "./national-skp";

describe("createChildClaimError — syarat Buat Klaim", () => {
  const cabang: ChildClaimActor = { role: "distributor", is_active: true, distributor_id: "co-edm" };
  const induk: ChildClaimParent = {
    status: "approved",
    is_national: true,
    parent_campaign_id: null,
    skp_number: "0049/WWI/11/2026",
  };

  it("akun distributor aktif berperusahaan boleh pada induk nasional Disetujui", () => {
    expect(createChildClaimError(cabang, induk, 0)).toBeNull();
  });

  it("role selain distributor ditolak, termasuk admin", () => {
    for (const role of ["admin", "superadmin", "finance", "manager", "user"]) {
      expect(createChildClaimError({ ...cabang, role }, induk, 0)).toBe(
        NATIONAL_SKP_MESSAGES.childNotDistributor
      );
    }
  });

  it("akun nonaktif atau tanpa perusahaan ditolak", () => {
    expect(createChildClaimError({ ...cabang, is_active: false }, induk, 0)).toBe(
      NATIONAL_SKP_MESSAGES.childInactive
    );
    expect(createChildClaimError({ ...cabang, distributor_id: null }, induk, 0)).toBe(
      NATIONAL_SKP_MESSAGES.childNoCompany
    );
  });

  it("hanya induk nasional — SKP biasa dan klaim turunan ditolak", () => {
    expect(createChildClaimError(cabang, { ...induk, is_national: false }, 0)).toBe(
      NATIONAL_SKP_MESSAGES.notNational
    );
    expect(
      createChildClaimError(cabang, { ...induk, is_national: false, parent_campaign_id: "x" }, 0)
    ).toBe(NATIONAL_SKP_MESSAGES.notNational);
  });

  it("induk harus berstatus Disetujui dan sudah bernomor", () => {
    for (const status of ["draft", "submitted", "rejected", "completed", "cancelled"]) {
      expect(createChildClaimError(cabang, { ...induk, status }, 0)).toBe(
        NATIONAL_SKP_MESSAGES.childParentNotApproved
      );
    }
    expect(createChildClaimError(cabang, { ...induk, skp_number: null }, 0)).toBe(
      NATIONAL_SKP_MESSAGES.childParentNoNumber
    );
  });

  it("ditolak selama akun masih punya klaim turunan yang belum diajukan", () => {
    expect(createChildClaimError(cabang, induk, 1)).toBe(NATIONAL_SKP_MESSAGES.childOpenClaimExists);
  });
});

describe("nomor dan nama klaim turunan", () => {
  it("nomor = nomor induk + -K + urutan dua digit", () => {
    expect(childSkpNumber("0049/WWI/11/2026", 1)).toBe("0049/WWI/11/2026-K01");
    expect(childSkpNumber("0049/WWI/11/2026", 12)).toBe("0049/WWI/11/2026-K12");
    expect(childSkpNumber("0049/WWI/11/2026", 123)).toBe("0049/WWI/11/2026-K123");
  });

  it("nama = nama induk – klaim nama akun, bernomor mulai klaim kedua akun itu", () => {
    expect(childClaimName("O Pao 300 Extra 300", "Roro Ajheng - Samarinda", 1)).toBe(
      "O Pao 300 Extra 300 – klaim Roro Ajheng - Samarinda"
    );
    expect(childClaimName("O Pao 300 Extra 300", "Roro Ajheng - Samarinda", 2)).toBe(
      "O Pao 300 Extra 300 – klaim Roro Ajheng - Samarinda (2)"
    );
  });
});

describe("isNationalChild & tanda terima", () => {
  it("mengenali klaim turunan dari parent_campaign_id", () => {
    expect(isNationalChild({ parent_campaign_id: "induk" })).toBe(true);
    expect(isNationalChild({ parent_campaign_id: null })).toBe(false);
    expect(isNationalChild(null)).toBe(false);
  });

  it("induk dan turunan tidak memakai tanda terima; SKP biasa boleh", () => {
    expect(nationalReceiptError({ is_national: true })).toBe(NATIONAL_SKP_MESSAGES.parentActivity);
    expect(nationalReceiptError({ parent_campaign_id: "induk" })).toBe(
      NATIONAL_SKP_MESSAGES.childNoReceipt
    );
    expect(nationalReceiptError({ is_national: false, parent_campaign_id: null })).toBeNull();
  });
});

// ============================================================
// Fase 3: klaim berulang dan pembatalan
// ============================================================

describe("isOpenChildClaimStatus — klaim turunan yang belum diajukan", () => {
  it("Disetujui dan Berjalan menghalangi klaim baru", () => {
    expect(isOpenChildClaimStatus("approved")).toBe(true);
    expect(isOpenChildClaimStatus("ongoing")).toBe(true);
    expect([...OPEN_CHILD_CLAIM_STATUSES].sort()).toEqual(["approved", "ongoing"]);
  });

  it("Klaim Diajukan ke atas dan Dibatalkan tidak menghalangi", () => {
    for (const status of ["claim_submitted", "claim_verified", "ready_to_pay", "paid", "completed", "cancelled"]) {
      expect(isOpenChildClaimStatus(status)).toBe(false);
    }
  });
});

describe("cancelChildClaimError", () => {
  const OWNER = "user-owner";
  const owner = { id: OWNER, role: "distributor", is_active: true };
  const turunan = (over: Partial<CancelChildClaimTarget> = {}): CancelChildClaimTarget => ({
    parent_campaign_id: "skp-induk",
    claim_owner_id: OWNER,
    status: "approved",
    ...over,
  });

  it("pemilik boleh membatalkan turunan Disetujui tanpa realisasi", () => {
    expect(cancelChildClaimError(owner, turunan(), 0)).toBeNull();
  });

  it("admin/superadmin boleh membatalkan turunan akun lain dengan syarat yang sama", () => {
    for (const role of ["admin", "superadmin"]) {
      const actor = { id: "admin-1", role, is_active: true };
      expect(cancelChildClaimError(actor, turunan(), 0)).toBeNull();
      expect(cancelChildClaimError(actor, turunan(), 1)).toBe(NATIONAL_SKP_MESSAGES.cancelHasRealization);
      expect(cancelChildClaimError(actor, turunan({ status: "claim_submitted" }), 0)).toBe(
        NATIONAL_SKP_MESSAGES.cancelAlreadySubmitted
      );
    }
  });

  it("akun distributor lain dan role internal lain ditolak", () => {
    expect(cancelChildClaimError({ id: "user-rekan", role: "distributor", is_active: true }, turunan(), 0)).toBe(
      NATIONAL_SKP_MESSAGES.cancelNotOwner
    );
    for (const role of ["finance", "manager", "user"]) {
      expect(cancelChildClaimError({ id: OWNER, role, is_active: true }, turunan(), 0)).toBe(
        NATIONAL_SKP_MESSAGES.cancelNotOwner
      );
    }
  });

  it("akun nonaktif ditolak", () => {
    expect(cancelChildClaimError({ ...owner, is_active: false }, turunan(), 0)).toBe(
      NATIONAL_SKP_MESSAGES.childInactive
    );
  });

  it("SKP biasa dan SKP induk bukan klaim turunan", () => {
    expect(cancelChildClaimError(owner, turunan({ parent_campaign_id: null }), 0)).toBe(
      NATIONAL_SKP_MESSAGES.cancelNotChild
    );
  });

  it("ditolak bila sudah ada realisasi", () => {
    expect(cancelChildClaimError(owner, turunan(), 1)).toBe(NATIONAL_SKP_MESSAGES.cancelHasRealization);
    // Berjalan = Finance sudah mencatat realisasi
    expect(cancelChildClaimError(owner, turunan({ status: "ongoing" }), 0)).toBe(
      NATIONAL_SKP_MESSAGES.cancelHasRealization
    );
  });

  it("ditolak bila sudah diajukan", () => {
    for (const status of ["claim_submitted", "claim_verified", "ready_to_pay", "paid", "completed"]) {
      expect(cancelChildClaimError(owner, turunan({ status }), 0)).toBe(
        NATIONAL_SKP_MESSAGES.cancelAlreadySubmitted
      );
    }
  });

  it("klaim yang sudah dibatalkan tidak dibatalkan dua kali", () => {
    expect(cancelChildClaimError(owner, turunan({ status: "cancelled" }), 0)).toBe(
      NATIONAL_SKP_MESSAGES.cancelAlreadyCancelled
    );
  });
});

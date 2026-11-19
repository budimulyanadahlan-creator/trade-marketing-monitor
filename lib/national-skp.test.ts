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
import { claimSubmittedCreatorId, isPaidToastRecipient } from "./national-skp";
import {
  activeChildClaimCountByParentId,
  nationalBudgetSummary,
  type NationalBudgetChild,
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

describe("claimSubmittedCreatorId — penerima email klaim diajukan (Fase 4)", () => {
  it("SKP biasa → pembuat SKP itu", () => {
    expect(claimSubmittedCreatorId({ created_by: "asm", parent_campaign_id: null }, null)).toBe("asm");
  });

  it("klaim turunan → pembuat SKP induk, bukan pembuat turunan", () => {
    expect(
      claimSubmittedCreatorId(
        { created_by: "distributor-pemilik", parent_campaign_id: "induk" },
        { created_by: "admin-pembuat-induk" }
      )
    ).toBe("admin-pembuat-induk");
  });

  it("klaim turunan yang induknya tidak terbaca → tidak ada pembuat (hanya Finance)", () => {
    expect(
      claimSubmittedCreatorId({ created_by: "distributor-pemilik", parent_campaign_id: "induk" }, null)
    ).toBeNull();
  });
});

describe("isPaidToastRecipient — toast realtime dibayar (Fase 4)", () => {
  const pusat = { id: "u-pusat", role: "distributor", distributor_id: "edm" };
  const cabang = { id: "u-cabang", role: "distributor", distributor_id: "edm" };

  it("SKP biasa → semua akun distributor perusahaan SKP", () => {
    const skp = { distributor_id: "edm", parent_campaign_id: null, claim_owner_id: null };
    expect(isPaidToastRecipient(skp, pusat)).toBe(true);
    expect(isPaidToastRecipient(skp, cabang)).toBe(true);
    expect(isPaidToastRecipient(skp, { ...cabang, distributor_id: "mms" })).toBe(false);
    expect(isPaidToastRecipient(skp, { ...cabang, distributor_id: null })).toBe(false);
    expect(isPaidToastRecipient({ ...skp, distributor_id: null }, { ...cabang, distributor_id: null })).toBe(false);
  });

  it("klaim turunan → hanya pemilik, bukan pusat atau rekan seperusahaan", () => {
    const turunan = { distributor_id: "edm", parent_campaign_id: "induk", claim_owner_id: "u-cabang" };
    expect(isPaidToastRecipient(turunan, cabang)).toBe(true);
    expect(isPaidToastRecipient(turunan, pusat)).toBe(false);
    expect(isPaidToastRecipient(turunan, { ...cabang, id: "u-cabang-2" })).toBe(false);
  });

  it("role selain distributor tidak pernah menerima toast ini", () => {
    const skp = { distributor_id: "edm", parent_campaign_id: null, claim_owner_id: null };
    expect(isPaidToastRecipient(skp, { id: "u-fin", role: "finance", distributor_id: "edm" })).toBe(false);
  });
});

// ============================================================
// Pantauan budget di SKP induk (Fase 5)
// ============================================================

function turunan(over: Partial<NationalBudgetChild> = {}): NationalBudgetChild {
  return { status: "approved", claim_amount: null, actual_spent: 0, ...over };
}

describe("nationalBudgetSummary", () => {
  it("induk tanpa turunan: semua total nol, sisa = nilai SKP, tanpa peringatan", () => {
    expect(nationalBudgetSummary(1_000_000, [])).toEqual({
      skpValue: 1_000_000,
      activeClaimCount: 0,
      totalClaimed: 0,
      totalVerified: 0,
      totalRealization: 0,
      remaining: 1_000_000,
      overClaimed: false,
      excess: 0,
    });
  });

  it("total klaim hanya menjumlah turunan berstatus Klaim Diajukan ke atas", () => {
    const s = nationalBudgetSummary(10_000, [
      turunan({ status: "approved", claim_amount: 9_999 }),
      turunan({ status: "ongoing", claim_amount: 9_999 }),
      turunan({ status: "cancelled", claim_amount: 9_999 }),
      turunan({ status: "claim_submitted", claim_amount: 1_000 }),
      turunan({ status: "claim_verified", claim_amount: 2_000 }),
      turunan({ status: "ready_to_pay", claim_amount: 300 }),
      turunan({ status: "paid", claim_amount: 40 }),
      turunan({ status: "completed", claim_amount: 5 }),
    ]);
    expect(s.totalClaimed).toBe(3_345);
    expect(s.remaining).toBe(6_655);
  });

  it("total terverifikasi hanya menjumlah turunan berstatus Terverifikasi ke atas", () => {
    const s = nationalBudgetSummary(10_000, [
      turunan({ status: "claim_submitted", claim_amount: 1_000 }),
      turunan({ status: "claim_verified", claim_amount: 2_000 }),
      turunan({ status: "ready_to_pay", claim_amount: 300 }),
      turunan({ status: "paid", claim_amount: 40 }),
      turunan({ status: "completed", claim_amount: 5 }),
    ]);
    expect(s.totalVerified).toBe(2_345);
  });

  it("total realisasi menjumlah realisasi semua turunan", () => {
    const s = nationalBudgetSummary(10_000, [
      turunan({ status: "ongoing", actual_spent: 700 }),
      turunan({ status: "claim_submitted", claim_amount: 500, actual_spent: 500 }),
      turunan({ status: "approved" }),
    ]);
    expect(s.totalRealization).toBe(1_200);
  });

  it("jumlah klaim tidak menghitung turunan yang dibatalkan", () => {
    const s = nationalBudgetSummary(10_000, [
      turunan({ status: "approved" }),
      turunan({ status: "cancelled" }),
      turunan({ status: "paid", claim_amount: 1 }),
    ]);
    expect(s.activeClaimCount).toBe(2);
  });

  it("total klaim melampaui nilai induk: peringatan dengan selisihnya, sisa negatif", () => {
    const s = nationalBudgetSummary(1_000, [
      turunan({ status: "claim_submitted", claim_amount: 800 }),
      turunan({ status: "paid", claim_amount: 450 }),
    ]);
    expect(s.overClaimed).toBe(true);
    expect(s.excess).toBe(250);
    expect(s.remaining).toBe(-250);
  });

  it("total klaim sama persis dengan nilai induk: tanpa peringatan", () => {
    const s = nationalBudgetSummary(1_000, [
      turunan({ status: "claim_submitted", claim_amount: 1_000 }),
    ]);
    expect(s.overClaimed).toBe(false);
    expect(s.excess).toBe(0);
    expect(s.remaining).toBe(0);
  });

  it("induk bernilai Rp0 tidak pernah memunculkan peringatan dan tidak punya sisa", () => {
    const s = nationalBudgetSummary(0, [
      turunan({ status: "claim_submitted", claim_amount: 5_000_000 }),
    ]);
    expect(s.overClaimed).toBe(false);
    expect(s.excess).toBe(0);
    expect(s.remaining).toBeNull();
    expect(s.totalClaimed).toBe(5_000_000);
  });

  it("nilai induk kosong diperlakukan Rp0; nominal klaim kosong dihitung 0", () => {
    const s = nationalBudgetSummary(null, [
      turunan({ status: "claim_submitted", claim_amount: null }),
    ]);
    expect(s.skpValue).toBe(0);
    expect(s.totalClaimed).toBe(0);
    expect(s.overClaimed).toBe(false);
  });
});

describe("activeChildClaimCountByParentId", () => {
  it("menghitung turunan per induk tanpa yang dibatalkan", () => {
    expect(
      activeChildClaimCountByParentId([
        { parent_campaign_id: "a", status: "approved" },
        { parent_campaign_id: "a", status: "cancelled" },
        { parent_campaign_id: "a", status: "completed" },
        { parent_campaign_id: "b", status: "cancelled" },
        { parent_campaign_id: "c", status: "claim_submitted" },
        { parent_campaign_id: null, status: "approved" },
      ])
    ).toEqual({ a: 2, c: 1 });
  });
});

// ============================================================
// Batas klaim, tutup, dan selesai otomatis (Fase 7)
// ============================================================

import {
  claimDeadlineError,
  closeNationalError,
  isClaimDeadlinePassed,
  isSubmittedAfterDeadline,
  nationalAutoCompleteDue,
  reopenNationalError,
} from "./national-skp";

describe("nationalAutoCompleteDue — syarat selesai otomatis", () => {
  const tertutup = {
    is_national: true,
    status: "approved",
    national_closed_at: "2026-11-20T03:00:00Z",
  };

  it("induk tertutup selesai saat semua turunannya Selesai atau Dibatalkan", () => {
    expect(nationalAutoCompleteDue(tertutup, ["completed", "cancelled", "completed"])).toBe(true);
  });

  it("induk tertutup tanpa turunan langsung selesai", () => {
    expect(nationalAutoCompleteDue(tertutup, [])).toBe(true);
  });

  it("belum selesai selama masih ada turunan yang berjalan", () => {
    for (const status of [
      "approved",
      "ongoing",
      "claim_submitted",
      "claim_verified",
      "ready_to_pay",
      "paid",
    ]) {
      expect(nationalAutoCompleteDue(tertutup, ["completed", status])).toBe(false);
    }
  });

  it("induk yang belum ditutup tidak pernah selesai otomatis", () => {
    const terbuka = { ...tertutup, national_closed_at: null };
    expect(nationalAutoCompleteDue(terbuka, [])).toBe(false);
    expect(nationalAutoCompleteDue(terbuka, ["completed", "cancelled"])).toBe(false);
  });

  it("hanya induk nasional berstatus Disetujui", () => {
    expect(nationalAutoCompleteDue({ ...tertutup, is_national: false }, [])).toBe(false);
    expect(nationalAutoCompleteDue({ ...tertutup, status: "completed" }, [])).toBe(false);
    expect(nationalAutoCompleteDue({ ...tertutup, status: "cancelled" }, [])).toBe(false);
  });
});

describe("batas klaim — pengingat, bukan pemblokir", () => {
  it("terlewat mulai sehari setelah tanggal batas, menurut tanggal WIB", () => {
    // 2026-11-30 23:30 WIB = 16:30 UTC → masih hari batas.
    expect(isClaimDeadlinePassed("2026-11-30", new Date("2026-11-30T16:30:00Z"))).toBe(false);
    // 2026-12-01 00:30 WIB = 2026-11-30 17:30 UTC → sudah lewat.
    expect(isClaimDeadlinePassed("2026-11-30", new Date("2026-11-30T17:30:00Z"))).toBe(true);
    expect(isClaimDeadlinePassed("2026-11-30", new Date("2026-11-15T03:00:00Z"))).toBe(false);
  });

  it("tanpa batas klaim tidak pernah terlewat", () => {
    expect(isClaimDeadlinePassed(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
    expect(isClaimDeadlinePassed(undefined, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("klaim diajukan setelah batas: tanggal pengajuan WIB melewati batas", () => {
    expect(isSubmittedAfterDeadline("2026-11-30", "2026-11-30T16:59:00Z")).toBe(false);
    expect(isSubmittedAfterDeadline("2026-11-30", "2026-11-30T17:01:00Z")).toBe(true);
    expect(isSubmittedAfterDeadline("2026-11-30", "2026-12-05T02:00:00Z")).toBe(true);
  });

  it("belum diajukan atau tanpa batas klaim → bukan terlambat", () => {
    expect(isSubmittedAfterDeadline("2026-11-30", null)).toBe(false);
    expect(isSubmittedAfterDeadline(null, "2026-12-05T02:00:00Z")).toBe(false);
  });

  it("batas klaim tidak pernah menolak pembuatan klaim", () => {
    const cabang = { role: "distributor", is_active: true, distributor_id: "co-edm" };
    const induk = {
      status: "approved",
      is_national: true,
      parent_campaign_id: null,
      skp_number: "0049/WWI/11/2026",
      claim_deadline: "2020-01-01",
      national_closed_at: null,
    };
    expect(createChildClaimError(cabang, induk, 0)).toBeNull();
  });
});

describe("claimDeadlineError — mengisi batas klaim", () => {
  const admin = { role: "admin" };
  const induk = { is_national: true, parent_campaign_id: null };

  it("admin/superadmin boleh mengisi, mengubah, dan mengosongkan", () => {
    expect(claimDeadlineError(admin, induk, "2026-12-31")).toBeNull();
    expect(claimDeadlineError({ role: "superadmin" }, induk, "2026-12-31")).toBeNull();
    expect(claimDeadlineError(admin, induk, null)).toBeNull();
  });

  it("role lain ditolak", () => {
    for (const role of ["finance", "manager", "user", "distributor"]) {
      expect(claimDeadlineError({ role }, induk, "2026-12-31")).toBe(NATIONAL_SKP_MESSAGES.notAdmin);
    }
  });

  it("hanya pada SKP induk nasional", () => {
    expect(claimDeadlineError(admin, { is_national: false }, "2026-12-31")).toBe(
      NATIONAL_SKP_MESSAGES.notNational
    );
    expect(
      claimDeadlineError(admin, { is_national: false, parent_campaign_id: "induk" }, "2026-12-31")
    ).toBe(NATIONAL_SKP_MESSAGES.notNational);
  });

  it("tanggal harus berformat YYYY-MM-DD dan nyata", () => {
    for (const bad of ["31-12-2026", "2026-13-01", "2026-02-30", "besok", ""]) {
      expect(claimDeadlineError(admin, induk, bad)).toBe(NATIONAL_SKP_MESSAGES.deadlineInvalid);
    }
  });
});

describe("closeNationalError / reopenNationalError — tutup dan buka kembali", () => {
  const admin = { role: "admin" };
  const terbuka = { is_national: true, status: "approved", national_closed_at: null };
  const tertutup = { ...terbuka, national_closed_at: "2026-11-20T03:00:00Z" };

  it("admin/superadmin menutup induk nasional Disetujui yang masih terbuka", () => {
    expect(closeNationalError(admin, terbuka)).toBeNull();
    expect(closeNationalError({ role: "superadmin" }, terbuka)).toBeNull();
  });

  it("tutup ditolak: bukan admin, bukan nasional, bukan Disetujui, sudah ditutup", () => {
    expect(closeNationalError({ role: "finance" }, terbuka)).toBe(NATIONAL_SKP_MESSAGES.notAdmin);
    expect(closeNationalError(admin, { ...terbuka, is_national: false })).toBe(
      NATIONAL_SKP_MESSAGES.notNational
    );
    expect(closeNationalError(admin, { ...terbuka, status: "draft" })).toBe(
      NATIONAL_SKP_MESSAGES.closeNotApproved
    );
    expect(closeNationalError(admin, tertutup)).toBe(NATIONAL_SKP_MESSAGES.alreadyClosed);
  });

  it("admin/superadmin membuka kembali induk tertutup yang belum Selesai", () => {
    expect(reopenNationalError(admin, tertutup)).toBeNull();
    expect(reopenNationalError({ role: "superadmin" }, tertutup)).toBeNull();
  });

  it("buka kembali ditolak: bukan admin, belum ditutup, sudah Selesai", () => {
    expect(reopenNationalError({ role: "finance" }, tertutup)).toBe(NATIONAL_SKP_MESSAGES.notAdmin);
    expect(reopenNationalError({ role: "distributor" }, tertutup)).toBe(
      NATIONAL_SKP_MESSAGES.notAdmin
    );
    expect(reopenNationalError(admin, terbuka)).toBe(NATIONAL_SKP_MESSAGES.notClosed);
    expect(reopenNationalError(admin, { ...tertutup, status: "completed" })).toBe(
      NATIONAL_SKP_MESSAGES.reopenCompleted
    );
  });

  it("induk tertutup menolak klaim turunan baru", () => {
    const cabang = { role: "distributor", is_active: true, distributor_id: "co-edm" };
    const induk = {
      status: "approved",
      is_national: true,
      parent_campaign_id: null,
      skp_number: "0049/WWI/11/2026",
      national_closed_at: "2026-11-20T03:00:00Z",
    };
    expect(createChildClaimError(cabang, induk, 0)).toBe(NATIONAL_SKP_MESSAGES.childParentClosed);
    // Induk tertutup yang sudah Selesai: alasannya tetap "sudah ditutup".
    expect(createChildClaimError(cabang, { ...induk, status: "completed" }, 0)).toBe(
      NATIONAL_SKP_MESSAGES.childParentClosed
    );
  });
});

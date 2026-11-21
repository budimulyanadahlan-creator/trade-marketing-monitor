import { describe, it, expect } from "vitest";
import { DISTRIBUTOR_GUARD_MESSAGES } from "./distributor-campaign-guard";
import {
  SPECIAL_UPLOADER_MESSAGES,
  allSpecialUploadersInactive,
  isActiveSpecialUploader,
  isSpecialUploaderCandidate,
  planSpecialUploaderChanges,
  specialDocumentWindowError,
  specialUploaderReachError,
  type SpecialUploaderAccount,
} from "./claim-document-uploaders";

const EDM = "edm";

function account(overrides: Partial<SpecialUploaderAccount> = {}): SpecialUploaderAccount {
  return {
    id: "u-1",
    role: "distributor",
    is_active: true,
    distributor_id: EDM,
    distributor_scope: "pusat",
    ...overrides,
  };
}

describe("isSpecialUploaderCandidate", () => {
  it("accepts an active Pusat distributor account", () => {
    expect(isSpecialUploaderCandidate(account())).toBe(true);
  });

  it("rejects a Cabang account", () => {
    expect(isSpecialUploaderCandidate(account({ distributor_scope: "cabang" }))).toBe(false);
  });

  it("rejects a legacy account without scope", () => {
    expect(isSpecialUploaderCandidate(account({ distributor_scope: null }))).toBe(false);
  });

  it("rejects an inactive account", () => {
    expect(isSpecialUploaderCandidate(account({ is_active: false }))).toBe(false);
  });

  it("rejects non-distributor roles", () => {
    expect(isSpecialUploaderCandidate(account({ role: "finance" }))).toBe(false);
    expect(isSpecialUploaderCandidate(account({ role: "admin" }))).toBe(false);
  });

  it("rejects a distributor account without a company", () => {
    expect(isSpecialUploaderCandidate(account({ distributor_id: null }))).toBe(false);
  });
});

describe("isActiveSpecialUploader", () => {
  it("counts an active distributor account with a company", () => {
    expect(isActiveSpecialUploader(account())).toBe(true);
  });

  it("does not count a deactivated account", () => {
    expect(isActiveSpecialUploader(account({ is_active: false }))).toBe(false);
  });

  it("does not count an account that is no longer a distributor", () => {
    expect(isActiveSpecialUploader(account({ role: "user", distributor_id: null }))).toBe(false);
  });
});

describe("allSpecialUploadersInactive", () => {
  it("is false when nobody is appointed (rule simply not in use)", () => {
    expect(allSpecialUploadersInactive([])).toBe(false);
  });

  it("is false when at least one appointee is active", () => {
    expect(
      allSpecialUploadersInactive([account({ id: "a", is_active: false }), account({ id: "b" })])
    ).toBe(false);
  });

  it("is true when every appointee is inactive", () => {
    expect(
      allSpecialUploadersInactive([
        account({ id: "a", is_active: false }),
        account({ id: "b", is_active: false }),
      ])
    ).toBe(true);
  });
});

describe("planSpecialUploaderChanges", () => {
  it("adds newly selected candidates and removes deselected ones", () => {
    const plan = planSpecialUploaderChanges({
      currentIds: ["a", "b"],
      selectedIds: ["b", "c"],
      accounts: [account({ id: "c" })],
    });
    expect(plan).toEqual({ toAdd: ["c"], toRemove: ["a"] });
  });

  it("ignores duplicate selections", () => {
    const plan = planSpecialUploaderChanges({
      currentIds: [],
      selectedIds: ["c", "c"],
      accounts: [account({ id: "c" })],
    });
    expect(plan).toEqual({ toAdd: ["c"], toRemove: [] });
  });

  it("rejects a newly selected Cabang account", () => {
    const plan = planSpecialUploaderChanges({
      currentIds: [],
      selectedIds: ["c"],
      accounts: [account({ id: "c", distributor_scope: "cabang" })],
    });
    expect(plan).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.notCandidate });
  });

  it("rejects a newly selected account that does not exist", () => {
    const plan = planSpecialUploaderChanges({ currentIds: [], selectedIds: ["x"], accounts: [] });
    expect(plan).toEqual({ error: SPECIAL_UPLOADER_MESSAGES.notCandidate });
  });

  it("keeps an already-appointed account that has since been deactivated", () => {
    const plan = planSpecialUploaderChanges({
      currentIds: ["a"],
      selectedIds: ["a", "c"],
      accounts: [account({ id: "c" })],
    });
    expect(plan).toEqual({ toAdd: ["c"], toRemove: [] });
  });

  it("removes everyone when nothing is selected", () => {
    const plan = planSpecialUploaderChanges({ currentIds: ["a"], selectedIds: [], accounts: [] });
    expect(plan).toEqual({ toAdd: [], toRemove: ["a"] });
  });
});

// ============================================================
// Fase 2 — pengunggah khusus efektif & item terkunci
// ============================================================

import {
  effectiveSpecialUploaderIds,
  specialDocumentAccess,
  specialDocumentDeleteOverride,
  specialDocumentManualCheckError,
  specialDocumentUploadError,
  type AppointedUploader,
} from "./claim-document-uploaders";

const MMS = "mms";
const LAIN = "lain";

function appointed(overrides: Partial<AppointedUploader> = {}): AppointedUploader {
  return { id: "meriana", role: "distributor", is_active: true, distributor_id: EDM, ...overrides };
}

const skpEdm = { distributor_id: EDM, distributor_parent_id: null };
const skpMms = { distributor_id: MMS, distributor_parent_id: EDM };
const skpLain = { distributor_id: LAIN, distributor_parent_id: null };

describe("effectiveSpecialUploaderIds", () => {
  it("counts an appointee from the SKP's own company", () => {
    expect(effectiveSpecialUploaderIds(skpEdm, [appointed()])).toEqual(["meriana"]);
  });

  it("counts an appointee from the SKP company's parent", () => {
    expect(effectiveSpecialUploaderIds(skpMms, [appointed()])).toEqual(["meriana"]);
  });

  it("does not count an appointee from an unrelated company (luar grup)", () => {
    expect(effectiveSpecialUploaderIds(skpLain, [appointed()])).toEqual([]);
  });

  it("does not count a subsidiary's appointee on the parent company's SKP", () => {
    expect(effectiveSpecialUploaderIds(skpEdm, [appointed({ distributor_id: MMS })])).toEqual([]);
  });

  it("never counts a deactivated appointee", () => {
    expect(effectiveSpecialUploaderIds(skpEdm, [appointed({ is_active: false })])).toEqual([]);
  });

  it("never counts an appointee that is no longer a distributor", () => {
    expect(effectiveSpecialUploaderIds(skpEdm, [appointed({ role: "user" })])).toEqual([]);
  });

  it("is empty for an SKP without a company", () => {
    expect(
      effectiveSpecialUploaderIds({ distributor_id: null }, [appointed({ distributor_id: null })])
    ).toEqual([]);
  });

  it("keeps only the active appointees when several are appointed", () => {
    expect(
      effectiveSpecialUploaderIds(skpEdm, [
        appointed({ id: "a", is_active: false }),
        appointed({ id: "b" }),
        appointed({ id: "c", distributor_id: LAIN }),
      ])
    ).toEqual(["b"]);
  });
});

describe("specialDocumentUploadError", () => {
  const cabang = { id: "cabang-1", role: "distributor" };

  it("is null when the item is not locked — the existing rules decide", () => {
    expect(specialDocumentUploadError(cabang, [])).toBeNull();
  });

  it("allows an effective special uploader", () => {
    expect(specialDocumentUploadError({ id: "meriana", role: "distributor" }, ["meriana"])).toBeNull();
  });

  it("rejects any other distributor account with a message naming Pusat", () => {
    expect(specialDocumentUploadError(cabang, ["meriana"])).toBe(
      SPECIAL_UPLOADER_MESSAGES.uploadedByPusat
    );
    expect(SPECIAL_UPLOADER_MESSAGES.uploadedByPusat).toMatch(/Pusat/);
  });

  it("always allows admin and superadmin", () => {
    expect(specialDocumentUploadError({ id: "x", role: "admin" }, ["meriana"])).toBeNull();
    expect(specialDocumentUploadError({ id: "x", role: "superadmin" }, ["meriana"])).toBeNull();
  });

  it("rejects other internal roles on a locked item", () => {
    expect(specialDocumentUploadError({ id: "x", role: "finance" }, ["meriana"])).toBe(
      SPECIAL_UPLOADER_MESSAGES.uploadedByPusat
    );
  });
});

describe("specialDocumentManualCheckError", () => {
  it("rejects a manual check on a locked item for everyone, the uploader included", () => {
    expect(specialDocumentManualCheckError(["meriana"])).toBe(
      SPECIAL_UPLOADER_MESSAGES.manualCheckLocked
    );
  });

  it("allows a manual check on an item that is not locked", () => {
    expect(specialDocumentManualCheckError([])).toBeNull();
  });
});

describe("specialDocumentDeleteOverride", () => {
  it("lets admin/superadmin delete someone else's file on a locked item", () => {
    expect(specialDocumentDeleteOverride({ id: "x", role: "admin" }, ["meriana"])).toBe(true);
    expect(specialDocumentDeleteOverride({ id: "x", role: "superadmin" }, ["meriana"])).toBe(true);
  });

  it("does not change the delete rule for items that are not locked", () => {
    expect(specialDocumentDeleteOverride({ id: "x", role: "admin" }, [])).toBe(false);
  });

  it("gives distributors no override — only their own file, by the existing rule", () => {
    expect(specialDocumentDeleteOverride({ id: "meriana", role: "distributor" }, ["meriana"])).toBe(false);
  });
});

describe("specialDocumentAccess", () => {
  it("reports an unlocked item", () => {
    expect(specialDocumentAccess({ id: "cabang-1", role: "distributor" }, [])).toEqual({
      locked: false,
      canUpload: false,
      canDeleteAny: false,
    });
  });

  it("reports a locked item for a branch account", () => {
    expect(specialDocumentAccess({ id: "cabang-1", role: "distributor" }, ["meriana"])).toEqual({
      locked: true,
      canUpload: false,
      canDeleteAny: false,
    });
  });

  it("reports a locked item for the special uploader", () => {
    expect(specialDocumentAccess({ id: "meriana", role: "distributor" }, ["meriana"])).toEqual({
      locked: true,
      canUpload: true,
      canDeleteAny: false,
    });
  });

  it("reports a locked item for admin", () => {
    expect(specialDocumentAccess({ id: "x", role: "admin" }, ["meriana"])).toEqual({
      locked: true,
      canUpload: true,
      canDeleteAny: true,
    });
  });
});

// ============================================================
// Fase 3 — jangkauan lintas perusahaan
// ============================================================

describe("specialUploaderReachError", () => {
  it("allows an SKP the uploader may act on", () => {
    expect(specialUploaderReachError(null, { status: "ongoing" })).toBeNull();
  });

  it("allows a subsidiary's SKP the uploader can only view", () => {
    expect(specialUploaderReachError("parentViewOnly", { status: "approved" })).toBeNull();
  });

  it("allows another account's national child claim the uploader can only view", () => {
    expect(
      specialUploaderReachError("childClaimViewOnly", { parent_campaign_id: "induk", status: "ongoing" })
    ).toBeNull();
  });

  it("never reaches a national parent SKP", () => {
    expect(specialUploaderReachError("nationalViewOnly", { status: "approved" })).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.nationalViewOnly
    );
  });

  it("never reaches a cancelled child claim, whether owned or only viewed", () => {
    for (const denial of ["childClaimViewOnly", "claimCancelled"] as const) {
      expect(
        specialUploaderReachError(denial, { parent_campaign_id: "induk", status: "cancelled" })
      ).toBe(DISTRIBUTOR_GUARD_MESSAGES.claimCancelled);
    }
  });

  it("never reaches an SKP the uploader cannot see", () => {
    expect(specialUploaderReachError("otherCompany", { status: "ongoing" })).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.otherCompany
    );
    expect(specialUploaderReachError("otherRegion", { status: "ongoing" })).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.otherRegion
    );
    expect(
      specialUploaderReachError("notClaimOwner", { parent_campaign_id: "induk", status: "ongoing" })
    ).toBe(DISTRIBUTOR_GUARD_MESSAGES.notClaimOwner);
  });
});

describe("specialDocumentAccess — jangkauan (Fase 3)", () => {
  it("hides Upload from the special uploader on an SKP out of reach", () => {
    expect(
      specialDocumentAccess({ id: "meriana", role: "distributor" }, ["meriana"], "di luar jangkauan")
    ).toEqual({ locked: true, canUpload: false, canDeleteAny: false });
  });

  it("admin always reaches", () => {
    expect(specialDocumentAccess({ id: "x", role: "admin" }, ["meriana"], "apa pun").canUpload).toBe(true);
  });
});

describe("specialDocumentWindowError — jendela status item terkunci (Fase 4)", () => {
  it("open while the SKP is Disetujui / Berjalan, whatever the item status", () => {
    expect(specialDocumentWindowError("approved", null)).toBeNull();
    expect(specialDocumentWindowError("ongoing", null)).toBeNull();
  });

  it("open after Submit Klaim while the item is not yet accepted", () => {
    // masih kosong / belum ada baris verifikasi, menunggu diperiksa, diminta revisi
    expect(specialDocumentWindowError("claim_submitted", null)).toBeNull();
    expect(specialDocumentWindowError("claim_submitted", "pending")).toBeNull();
    expect(specialDocumentWindowError("claim_submitted", "revision_requested")).toBeNull();
  });

  it("closed once Finance accepted the item", () => {
    expect(specialDocumentWindowError("claim_submitted", "accepted")).toBe(
      SPECIAL_UPLOADER_MESSAGES.itemAccepted
    );
  });

  it("closed for every status after Klaim Diajukan, and before Disetujui", () => {
    for (const status of ["claim_verified", "ready_to_pay", "paid", "completed", "draft", "cancelled"]) {
      expect(specialDocumentWindowError(status, "pending")).toBe(
        SPECIAL_UPLOADER_MESSAGES.statusClosed
      );
    }
  });
});

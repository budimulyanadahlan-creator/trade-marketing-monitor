import { describe, it, expect } from "vitest";
import {
  SPECIAL_UPLOADER_MESSAGES,
  allSpecialUploadersInactive,
  isActiveSpecialUploader,
  isSpecialUploaderCandidate,
  planSpecialUploaderChanges,
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

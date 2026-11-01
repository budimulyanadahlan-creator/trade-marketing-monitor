import { describe, it, expect } from "vitest";
import {
  distributorParentError,
  DISTRIBUTOR_PARENT_MESSAGES,
} from "./distributor-parent";

const edm = "edm-id";
const mms = "mms-id";
const bir = "bir-id";

describe("distributorParentError", () => {
  it("allows no parent", () => {
    expect(
      distributorParentError({ selfId: mms, parentId: null, parent: null, hasChildren: false })
    ).toBeNull();
  });

  it("allows a parent that has no parent itself when self has no children", () => {
    expect(
      distributorParentError({
        selfId: mms,
        parentId: edm,
        parent: { id: edm, parent_distributor_id: null },
        hasChildren: false,
      })
    ).toBeNull();
  });

  it("rejects pointing to itself", () => {
    expect(
      distributorParentError({
        selfId: edm,
        parentId: edm,
        parent: { id: edm, parent_distributor_id: null },
        hasChildren: true,
      })
    ).toBe(DISTRIBUTOR_PARENT_MESSAGES.self);
  });

  it("rejects a parent that is not found", () => {
    expect(
      distributorParentError({ selfId: mms, parentId: "missing", parent: null, hasChildren: false })
    ).toBe(DISTRIBUTOR_PARENT_MESSAGES.notFound);
  });

  it("rejects two levels: parent already has a parent", () => {
    expect(
      distributorParentError({
        selfId: bir,
        parentId: mms,
        parent: { id: mms, parent_distributor_id: edm },
        hasChildren: false,
      })
    ).toBe(DISTRIBUTOR_PARENT_MESSAGES.twoLevels);
  });

  it("rejects a cycle: self already is a parent of someone (incl. the chosen parent)", () => {
    expect(
      distributorParentError({
        selfId: edm,
        parentId: mms,
        parent: { id: mms, parent_distributor_id: edm },
        hasChildren: true,
      })
    ).toBe(DISTRIBUTOR_PARENT_MESSAGES.hasChildren);
  });

  it("allows a new distributor (no selfId yet) to take a parent", () => {
    expect(
      distributorParentError({
        selfId: null,
        parentId: edm,
        parent: { id: edm, parent_distributor_id: null },
        hasChildren: false,
      })
    ).toBeNull();
  });
});

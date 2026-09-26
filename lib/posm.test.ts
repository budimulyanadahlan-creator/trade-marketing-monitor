import { describe, it, expect } from "vitest";
import { canManagePosm, nextCode } from "./posm";

describe("nextCode", () => {
  it("returns the number after the largest standard code", () => {
    expect(nextCode("POSM", ["POSM-0001", "POSM-0007", "POSM-0003"])).toBe("POSM-0008");
  });

  it("starts at 0001 when there are no codes yet", () => {
    expect(nextCode("POSM", [])).toBe("POSM-0001");
  });

  it("ignores manually typed codes that do not follow the standard format", () => {
    expect(nextCode("POSM", ["WBL-99", "POSM-0002", "POSM-ABC", "XPOSM-0050"])).toBe("POSM-0003");
  });

  it("keeps counting past 9999 without truncating", () => {
    expect(nextCode("AST", ["AST-9999"])).toBe("AST-10000");
  });
});

describe("canManagePosm", () => {
  it("allows a user from the Trade Marketing department", () => {
    expect(canManagePosm({ role: "user", departmentName: "Trade Marketing" })).toBe(true);
  });

  it("allows a manager from the Marketing department, case-insensitively", () => {
    expect(canManagePosm({ role: "manager", departmentName: "  MARKETING " })).toBe(true);
  });

  it("allows admin and superadmin from any department", () => {
    expect(canManagePosm({ role: "admin", departmentName: "Finance" })).toBe(true);
    expect(canManagePosm({ role: "superadmin", departmentName: null })).toBe(true);
  });

  it("denies users from other departments and finance", () => {
    expect(canManagePosm({ role: "user", departmentName: "Sales" })).toBe(false);
    expect(canManagePosm({ role: "finance", departmentName: "Finance" })).toBe(false);
    expect(canManagePosm({ role: "manager", departmentName: null })).toBe(false);
  });

  it("denies a distributor even if linked to a Marketing department", () => {
    expect(canManagePosm({ role: "distributor", departmentName: "Marketing" })).toBe(false);
  });
});

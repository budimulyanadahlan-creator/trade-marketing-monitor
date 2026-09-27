import { describe, it, expect } from "vitest";
import { nextCode } from "./posm";
import {
  distinctPrograms,
  GIMMICK_CATEGORIES,
  GIMMICK_CODE_PREFIX,
  GIMMICK_UNITS,
  monitoringPosmTabs,
  resolveMonitoringPosmTab,
} from "./gimmick";

describe("resolveMonitoringPosmTab", () => {
  it("opens the gimmick tab for a writer", () => {
    expect(resolveMonitoringPosmTab("gimmick", true)).toBe("gimmick");
  });

  it("sends a non-writer who opens the gimmick tab to the POSM tab", () => {
    expect(resolveMonitoringPosmTab("gimmick", false)).toBe("posm");
  });

  it("keeps the asset tab for everyone and defaults to POSM", () => {
    expect(resolveMonitoringPosmTab("asset", false)).toBe("asset");
    expect(resolveMonitoringPosmTab(undefined, true)).toBe("posm");
    expect(resolveMonitoringPosmTab("lain", true)).toBe("posm");
  });
});

describe("monitoringPosmTabs", () => {
  it("lists the gimmick tab only for a writer", () => {
    expect(monitoringPosmTabs(true).map((t) => t.value)).toEqual(["posm", "asset", "gimmick"]);
    expect(monitoringPosmTabs(false).map((t) => t.value)).toEqual(["posm", "asset"]);
  });
});

describe("distinctPrograms", () => {
  it("lists each program once, case-insensitively, sorted, skipping empty values", () => {
    const items = [
      { program: "Imlek 2027" },
      { program: "Lebaran 2027" },
      { program: "imlek 2027 " },
      { program: null },
      { program: "  " },
    ];
    expect(distinctPrograms(items)).toEqual(["Imlek 2027", "Lebaran 2027"]);
  });
});

describe("gimmick constants", () => {
  it("match the fixed lists in the gimmick_items check constraints", () => {
    expect(GIMMICK_CATEGORIES).toEqual(["Payung", "Tas", "Botol/Gelas", "Mainan", "Pakaian", "Alat Tulis", "Lainnya"]);
    expect(GIMMICK_UNITS).toEqual(["pcs", "set"]);
  });

  it("suggests the next GMK code", () => {
    expect(nextCode(GIMMICK_CODE_PREFIX, ["GMK-0001", "gmk-0007", "PAYUNG-A"])).toBe("GMK-0008");
    expect(nextCode(GIMMICK_CODE_PREFIX, [])).toBe("GMK-0001");
  });
});

import { describe, it, expect } from "vitest";
import { nextCode } from "./posm";
import {
  cartonsToPcs,
  formatPcsWithCartons,
  summarizeGimmickStock,
  withRunningValue,
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

describe("cartonsToPcs", () => {
  it("converts 3 cartons + 5 pcs of a 24-per-carton item to 77 pcs", () => {
    expect(cartonsToPcs({ cartons: 3, pcs: 5 }, 24)).toBe(77);
  });
});

describe("formatPcsWithCartons", () => {
  it("shows the carton breakdown next to the pcs total", () => {
    expect(formatPcsWithCartons(77, 24, "pcs")).toBe("77 pcs (3 krt + 5 pcs)");
  });

  it("omits the remainder for whole cartons and the breakdown below one carton", () => {
    expect(formatPcsWithCartons(72, 24, "pcs")).toBe("72 pcs (3 krt)");
    expect(formatPcsWithCartons(5, 24, "pcs")).toBe("5 pcs");
  });

  it("shows only the total for items without a carton size, using thousand separators", () => {
    expect(formatPcsWithCartons(1200, null, "set")).toBe("1.200 set");
  });

  it("breaks down the magnitude of negative quantities", () => {
    expect(formatPcsWithCartons(-77, 24, "pcs")).toBe("-77 pcs (3 krt + 5 pcs)");
  });
});

describe("summarizeGimmickStock", () => {
  const row = (is_active: boolean, balance: number, min_stock: number | null, unit_cost: number) => ({
    is_active,
    balance,
    min_stock,
    unit_cost,
  });

  it("counts active items by stock status and values all stock at the current master cost", () => {
    const summary = summarizeGimmickStock([
      row(true, 77, 24, 45000), // aman
      row(true, 10, 24, 12500), // menipis
      row(true, 0, null, 8000), // habis
      row(false, 4, null, 1000), // nonaktif: tidak dihitung status, nilainya tetap
    ]);

    expect(summary).toEqual({
      activeItems: 3,
      lowStock: 1,
      outOfStock: 1,
      totalValue: 77 * 45000 + 10 * 12500 + 4 * 1000,
    });
  });
});

describe("withRunningValue", () => {
  it("adds the running balance and the snapshot value of each transaction", () => {
    const rows = withRunningValue([
      { movement_date: "2026-09-02", created_at: "b", quantity: -5, unit_cost_snapshot: 50000 },
      { movement_date: "2026-09-01", created_at: "a", quantity: 77, unit_cost_snapshot: 45000 },
    ]);

    expect(rows.map((r) => [r.quantity, r.running_balance, r.value])).toEqual([
      [77, 77, 77 * 45000],
      [-5, 72, -5 * 50000],
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  aggregateOutRekap,
  availableFrom,
  balanceOf,
  canManagePosm,
  findBalanceViolation,
  monthDateBounds,
  monthRange,
  movementFiltersQuery,
  nextCode,
  summarizeAssets,
  parseMovementFilters,
  parseRekapFilters,
  withRunningBalance,
  signedQuantity,
  stockStatus,
} from "./posm";

const mv = (movement_date: string, quantity: number) => ({ movement_date, quantity });

describe("balanceOf", () => {
  it("sums signed quantities", () => {
    expect(balanceOf([mv("2026-01-01", 100), mv("2026-01-05", -30), mv("2026-01-06", 5)])).toBe(75);
  });

  it("is zero without movements", () => {
    expect(balanceOf([])).toBe(0);
  });
});

describe("findBalanceViolation", () => {
  it("returns null when the running balance never goes negative", () => {
    expect(findBalanceViolation([mv("2026-01-01", 100), mv("2026-01-05", -100)])).toBeNull();
  });

  it("flags an out that exceeds the balance", () => {
    expect(findBalanceViolation([mv("2026-01-01", 100), mv("2026-01-05", -120)])).toEqual({
      date: "2026-01-05",
      balance: -20,
    });
  });

  it("flags a backdated out before the stock came in, even if the final balance is positive", () => {
    expect(findBalanceViolation([mv("2026-01-10", 100), mv("2026-01-05", -30)])).toEqual({
      date: "2026-01-05",
      balance: -30,
    });
  });

  it("nets movements on the same day regardless of entry order", () => {
    expect(findBalanceViolation([mv("2026-01-05", -30), mv("2026-01-05", 50)])).toBeNull();
  });

  it("flags a later day that goes negative after an earlier in is reduced", () => {
    // Masuk diedit dari 100 menjadi 40, padahal sudah keluar 50.
    expect(findBalanceViolation([mv("2026-01-01", 40), mv("2026-01-03", -50), mv("2026-01-09", 20)])).toEqual({
      date: "2026-01-03",
      balance: -10,
    });
  });
});

describe("availableFrom", () => {
  const history = [mv("2026-01-01", 100), mv("2026-01-10", -80), mv("2026-01-20", 50)];

  it("is the lowest running balance from that date onward", () => {
    // Per 5 Jan saldo 100, tapi 10 Jan turun ke 20 → hanya 20 yang aman dikeluarkan.
    expect(availableFrom(history, "2026-01-05")).toBe(20);
  });

  it("uses the balance at the date when nothing happens afterwards", () => {
    expect(availableFrom(history, "2026-01-25")).toBe(70);
  });

  it("is zero before any stock exists", () => {
    expect(availableFrom(history, "2025-12-31")).toBe(0);
  });
});

describe("signedQuantity", () => {
  it("keeps opening and in positive", () => {
    expect(signedQuantity("opening", 100)).toBe(100);
    expect(signedQuantity("in", 25)).toBe(25);
  });

  it("makes out negative", () => {
    expect(signedQuantity("out", 30)).toBe(-30);
  });

  it("signs an adjustment by its direction", () => {
    expect(signedQuantity("adjustment", 5, "plus")).toBe(5);
    expect(signedQuantity("adjustment", 5, "minus")).toBe(-5);
  });

  it("treats the entered quantity as a magnitude", () => {
    expect(signedQuantity("out", -30)).toBe(-30);
    expect(signedQuantity("in", -25)).toBe(25);
  });
});

describe("stockStatus", () => {
  it("is habis when the balance is zero", () => {
    expect(stockStatus(0, 10)).toBe("habis");
    expect(stockStatus(0, null)).toBe("habis");
  });

  it("is menipis when the balance is at or below the minimum stock", () => {
    expect(stockStatus(10, 10)).toBe("menipis");
    expect(stockStatus(3, 10)).toBe("menipis");
  });

  it("is aman above the minimum, or when no minimum is set", () => {
    expect(stockStatus(11, 10)).toBe("aman");
    expect(stockStatus(1, null)).toBe("aman");
  });
});

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

describe("withRunningBalance", () => {
  it("adds the running balance in date order, then entry order within a day", () => {
    const rows = withRunningBalance([
      { id: "c", movement_date: "2026-01-05", quantity: -30, created_at: "2026-01-05T10:00:00Z" },
      { id: "a", movement_date: "2026-01-01", quantity: 100, created_at: "2026-01-06T00:00:00Z" },
      { id: "b", movement_date: "2026-01-05", quantity: 20, created_at: "2026-01-05T08:00:00Z" },
    ]);

    expect(rows.map((r) => [r.id, r.running_balance])).toEqual([
      ["a", 100],
      ["b", 120],
      ["c", 90],
    ]);
  });
});

describe("parseMovementFilters", () => {
  const UUID = "44444444-4444-4444-8444-444444444444";

  it("keeps valid filters and defaults to page 1", () => {
    expect(
      parseMovementFilters({
        from: "2026-01-01",
        to: "2026-03-31",
        type: "out",
        item: UUID,
        region: UUID,
        distributor: UUID,
      })
    ).toEqual({ from: "2026-01-01", to: "2026-03-31", type: "out", item: UUID, region: UUID, distributor: UUID, page: 1 });
  });

  it("drops malformed values instead of failing the query", () => {
    expect(
      parseMovementFilters({ from: "kemarin", type: "transfer", item: "abc", region: ["x", "y"], page: "-3" })
    ).toEqual({ page: 1 });
  });

  it("reads the page number", () => {
    expect(parseMovementFilters({ page: "4" })).toEqual({ page: 4 });
  });
});

describe("movementFiltersQuery", () => {
  it("serialises filters, omitting page 1 and empty values", () => {
    expect(movementFiltersQuery({ type: "out", region: "r1", page: 1 })).toBe("type=out&region=r1");
    expect(movementFiltersQuery({ from: "2026-01-01", page: 3 })).toBe("from=2026-01-01&page=3");
  });
});

describe("aggregateOutRekap", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const out = (item_code: string, region_name: string, movement_date: string, quantity: number, type = "out") => ({
    item_id: item_code,
    item_code,
    item_name: `Item ${item_code}`,
    unit: "pcs",
    region_id: region_name,
    region_name,
    movement_date,
    type: type as "opening" | "in" | "out" | "adjustment",
    quantity,
  });

  it("sums absolute out quantities per item × region × month with row, column and grand totals", () => {
    const rekap = aggregateOutRekap(
      [
        out("P1", "Jawa", "2026-01-05", -10),
        out("P1", "Jawa", "2026-01-20", -5),
        out("P1", "Jawa", "2026-03-01", -7),
        out("P1", "Bali", "2026-02-10", -3),
      ],
      months
    );

    expect(rekap.rows.map((r) => [r.item_code, r.region_name, r.months, r.total])).toEqual([
      ["P1", "Bali", [0, 3, 0], 3],
      ["P1", "Jawa", [15, 0, 7], 22],
    ]);
    expect(rekap.monthTotals).toEqual([15, 3, 7]);
    expect(rekap.grandTotal).toBe(25);
  });

  it("ignores opening, in and adjustment movements, and months outside the range", () => {
    const rekap = aggregateOutRekap(
      [
        out("P1", "Jawa", "2026-01-01", 100, "opening"),
        out("P1", "Jawa", "2026-01-02", 50, "in"),
        out("P1", "Jawa", "2026-01-03", -4, "adjustment"),
        out("P1", "Jawa", "2025-12-31", -9),
        out("P1", "Jawa", "2026-04-01", -9),
      ],
      months
    );

    expect(rekap).toEqual({ rows: [], monthTotals: [0, 0, 0], grandTotal: 0 });
  });
});

describe("parseRekapFilters", () => {
  const UUID = "44444444-4444-4444-8444-444444444444";
  const today = "2026-09-27";

  it("defaults to the last 6 months including the current month", () => {
    expect(parseRekapFilters({}, today)).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("keeps valid months and item/brand filters", () => {
    expect(parseRekapFilters({ from: "2026-01", to: "2026-03", item: UUID, brand: UUID }, today)).toEqual({
      from: "2026-01",
      to: "2026-03",
      item: UUID,
      brand: UUID,
    });
  });

  it("swaps a reversed range and drops malformed values", () => {
    expect(parseRekapFilters({ from: "2026-05", to: "2026-02", item: "abc", brand: ["x"] }, today)).toEqual({
      from: "2026-02",
      to: "2026-05",
    });
    expect(parseRekapFilters({ from: "2026-13", to: "Mei" }, today)).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("caps the range at 24 months counted back from the end month", () => {
    expect(parseRekapFilters({ from: "2020-01", to: "2026-09" }, today)).toEqual({ from: "2024-10", to: "2026-09" });
  });
});

describe("monthRange", () => {
  it("lists months inclusively across a year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("gives the first and last day for the date filter", () => {
    expect(monthDateBounds("2026-01", "2026-02")).toEqual({ start: "2026-01-01", end: "2026-02-28" });
    expect(monthDateBounds("2024-02", "2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
});

describe("summarizeAssets", () => {
  const asset = (acquisition_value: number, condition: string, destination: "warehouse" | "placed") => ({
    acquisition_value,
    condition: condition as "Baik",
    destination,
  });

  it("counts units, totals acquisition value, and splits by condition and location", () => {
    const summary = summarizeAssets([
      asset(5_000_000, "Baik", "placed"),
      asset(2_500_000, "Baik", "warehouse"),
      asset(1_000_000, "Rusak Ringan", "placed"),
    ]);

    expect(summary.totalUnits).toBe(3);
    expect(summary.totalValue).toBe(8_500_000);
    expect(summary.byCondition).toEqual({
      Baik: 2,
      "Rusak Ringan": 1,
      "Rusak Berat": 0,
      Hilang: 0,
      Dihapusbukukan: 0,
    });
    expect(summary.inWarehouse).toBe(1);
    expect(summary.placed).toBe(2);
  });

  it("returns zeros for no assets", () => {
    const summary = summarizeAssets([]);
    expect(summary.totalUnits).toBe(0);
    expect(summary.totalValue).toBe(0);
    expect(summary.inWarehouse + summary.placed).toBe(0);
  });
});

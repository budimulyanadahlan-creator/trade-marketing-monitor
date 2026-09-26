import { describe, it, expect } from "vitest";
import {
  availableFrom,
  balanceOf,
  canManagePosm,
  findBalanceViolation,
  nextCode,
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

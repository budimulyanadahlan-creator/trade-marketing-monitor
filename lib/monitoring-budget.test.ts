import { describe, it, expect } from "vitest";
import {
  getFiscalPeriod,
  getQuarterMonths,
  getQuarterDateRange,
  aggregateMonitoringBudget,
  resolveFiscalPeriod,
  summarizeMissingStartDate,
  type MonitoringCampaign,
} from "./monitoring-budget";
import type { CampaignStatus } from "@/types/database";

const CATEGORIES = [
  { id: "tp1", name: "Display", type: "TP" as const, account_code: "TP1" },
  { id: "tp3", name: "Promo Toko", type: "TP" as const, account_code: "TP3" },
  { id: "cp1", name: "Consumer Promo", type: "CP" as const, account_code: "CP1" },
];

function campaign(
  categoryId: string | null,
  budget: number,
  startDate: string,
  status: CampaignStatus = "approved"
): MonitoringCampaign {
  return {
    promotion_category_id: categoryId,
    requested_budget: budget,
    status,
    start_date: startDate,
  };
}

describe("getFiscalPeriod", () => {
  it("memetakan bulan kalender ke kuartal fiskal (Q1 = Apr–Jun)", () => {
    expect(getFiscalPeriod(new Date(2026, 7, 6))).toEqual({ fiscalYear: 2026, quarter: 2 }); // Agu 2026 → Q2
    expect(getFiscalPeriod(new Date(2026, 3, 1))).toEqual({ fiscalYear: 2026, quarter: 1 }); // Apr 2026 → Q1
    expect(getFiscalPeriod(new Date(2026, 11, 31))).toEqual({ fiscalYear: 2026, quarter: 3 }); // Des 2026 → Q3
  });

  it("Jan–Mar masuk Q4 tahun fiskal sebelumnya", () => {
    expect(getFiscalPeriod(new Date(2027, 0, 15))).toEqual({ fiscalYear: 2026, quarter: 4 });
    expect(getFiscalPeriod(new Date(2027, 2, 31))).toEqual({ fiscalYear: 2026, quarter: 4 });
  });
});

describe("getQuarterMonths", () => {
  it("mengembalikan 3 bulan kalender kuartal dengan label Indonesia", () => {
    expect(getQuarterMonths(2026, 2)).toEqual([
      { year: 2026, month: 7, label: "Juli 2026" },
      { year: 2026, month: 8, label: "Agustus 2026" },
      { year: 2026, month: 9, label: "September 2026" },
    ]);
  });

  it("Q4 tahun fiskal N jatuh di Jan–Mar tahun kalender N+1", () => {
    expect(getQuarterMonths(2026, 4)).toEqual([
      { year: 2027, month: 1, label: "Januari 2027" },
      { year: 2027, month: 2, label: "Februari 2027" },
      { year: 2027, month: 3, label: "Maret 2027" },
    ]);
  });
});

describe("getQuarterDateRange", () => {
  it("mengembalikan rentang tanggal inklusif-awal eksklusif-akhir untuk query", () => {
    expect(getQuarterDateRange(2026, 2)).toEqual({
      start: "2026-07-01",
      endExclusive: "2026-10-01",
    });
    expect(getQuarterDateRange(2026, 3)).toEqual({
      start: "2026-10-01",
      endExclusive: "2027-01-01",
    });
    expect(getQuarterDateRange(2026, 4)).toEqual({
      start: "2027-01-01",
      endExclusive: "2027-04-01",
    });
  });
});

describe("aggregateMonitoringBudget", () => {
  it("menjumlahkan SKP berstatus komitmen ke bucket bulan start_date dan menghitung variance", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [{ promotion_category_id: "tp1", total_amount: 1000 }],
      campaigns: [
        campaign("tp1", 100, "2026-07-05"),
        campaign("tp1", 200, "2026-07-20", "ongoing"),
        campaign("tp1", 300, "2026-08-10", "paid"),
        campaign("tp1", 50, "2026-09-01", "completed"),
        campaign("tp1", 40, "2026-09-15", "claim_submitted"),
        // status non-komitmen tidak terhitung
        campaign("tp1", 999, "2026-07-01", "cancelled"),
        campaign("tp1", 999, "2026-07-01", "approved_l1"),
        campaign("tp1", 999, "2026-07-01", "submitted"),
        campaign("tp1", 999, "2026-07-01", "draft"),
        // di luar kuartal tidak terhitung
        campaign("tp1", 999, "2026-06-30"),
      ],
    });

    expect(result.tpRows).toHaveLength(1);
    const row = result.tpRows[0];
    expect(row.accountCode).toBe("TP1");
    expect(row.months).toEqual([300, 300, 90]);
    expect(row.total).toBe(690);
    expect(row.budget).toBe(1000);
    expect(row.variance).toBe(310);
  });

  it("menghitung subtotal TP, subtotal CP, dan grand total konsisten", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [
        { promotion_category_id: "tp1", total_amount: 1000 },
        { promotion_category_id: "tp3", total_amount: 500 },
        { promotion_category_id: "cp1", total_amount: 2000 },
      ],
      campaigns: [
        campaign("tp1", 100, "2026-07-05"),
        campaign("tp3", 700, "2026-08-05"),
        campaign("cp1", 300, "2026-09-05"),
      ],
    });

    expect(result.tpRows.map((r) => r.accountCode)).toEqual(["TP1", "TP3"]);
    expect(result.totalTP).toEqual({
      budget: 1500,
      months: [100, 700, 0],
      total: 800,
      variance: 700,
    });
    expect(result.totalCP).toEqual({
      budget: 2000,
      months: [0, 0, 300],
      total: 300,
      variance: 1700,
    });
    expect(result.grandTotal).toEqual({
      budget: 3500,
      months: [100, 700, 300],
      total: 1100,
      variance: 2400,
    });
  });

  it("kategori ber-spending tanpa budget tampil dengan budget 0; kategori nol-nol disembunyikan; tanpa kategori masuk grand total saja", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [],
      campaigns: [
        campaign("tp3", 400, "2026-07-15"),
        campaign(null, 250, "2026-08-20"),
      ],
    });

    // tp1 dan cp1 tidak punya budget maupun spending → tidak muncul
    expect(result.tpRows.map((r) => r.accountCode)).toEqual(["TP3"]);
    expect(result.cpRows).toEqual([]);
    expect(result.tpRows[0].budget).toBe(0);
    expect(result.tpRows[0].variance).toBe(-400);

    expect(result.uncategorized).not.toBeNull();
    expect(result.uncategorized!.months).toEqual([0, 250, 0]);
    // Tanpa Kategori di luar subtotal TP/CP tapi ikut grand total
    expect(result.totalTP.total).toBe(400);
    expect(result.totalCP.total).toBe(0);
    expect(result.grandTotal.total).toBe(650);
    expect(result.grandTotal.variance).toBe(-650);
  });

  it("tidak menampilkan baris Tanpa Kategori jika nilainya nol", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [{ promotion_category_id: "tp1", total_amount: 100 }],
      campaigns: [campaign(null, 999, "2026-07-01", "cancelled")],
    });
    expect(result.uncategorized).toBeNull();
  });
});

describe("resolveFiscalPeriod", () => {
  it("memakai parameter fy/q dari URL jika valid", () => {
    expect(resolveFiscalPeriod("2025", "3")).toEqual({ fiscalYear: 2025, quarter: 3 });
  });

  it("fallback ke kuartal fiskal berjalan jika parameter kosong", () => {
    const now = new Date(2026, 7, 6); // Agustus 2026 → FY2026 Q2
    expect(resolveFiscalPeriod(undefined, undefined, now)).toEqual({
      fiscalYear: 2026,
      quarter: 2,
    });
  });

  it("fallback ke kuartal fiskal berjalan jika parameter tidak valid", () => {
    const now = new Date(2026, 7, 6);
    expect(resolveFiscalPeriod("abc", "9", now)).toEqual({ fiscalYear: 2026, quarter: 2 });
    expect(resolveFiscalPeriod("2025", "0", now)).toEqual({ fiscalYear: 2026, quarter: 2 });
    expect(resolveFiscalPeriod("2025", undefined, now)).toEqual({ fiscalYear: 2026, quarter: 2 });
  });
});

describe("summarizeMissingStartDate", () => {
  it("menjumlahkan jumlah dan nilai SKP komitmen tanpa start_date", () => {
    const result = summarizeMissingStartDate([
      campaign("tp1", 100, "", "approved"),
      { promotion_category_id: "tp1", requested_budget: 200, status: "ongoing", start_date: null },
      // punya start_date → tidak terhitung
      campaign("tp1", 300, "2026-07-01", "approved"),
      // status non-komitmen tanpa start_date → tidak terhitung
      { promotion_category_id: "tp1", requested_budget: 999, status: "draft", start_date: null },
    ]);
    expect(result).toEqual({ count: 2, total: 300 });
  });

  it("mengembalikan nol jika semua SKP komitmen punya start_date", () => {
    const result = summarizeMissingStartDate([campaign("tp1", 100, "2026-07-01", "approved")]);
    expect(result).toEqual({ count: 0, total: 0 });
  });
});

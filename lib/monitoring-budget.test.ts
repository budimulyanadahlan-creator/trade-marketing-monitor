import { describe, it, expect } from "vitest";
import {
  getFiscalPeriod,
  getQuarterMonths,
  getQuarterDateRange,
  aggregateMonitoringBudget,
  aggregateMonitoringBudgetRealisasi,
  resolveFiscalPeriod,
  resolveMonitoringMode,
  summarizeMissingStartDate,
  drilldownKey,
  buildKomitmenDrilldown,
  buildRealisasiDrilldown,
  allocateBudgetByRegion,
  summarizeExcludedRegion,
  REGION_CONTRIBUTIONS,
  type MonitoringCampaign,
  type MonitoringRealization,
  type RegionActual,
  type DrilldownCampaignInput,
  type DrilldownRealizationInput,
} from "./monitoring-budget";
import type { CampaignStatus } from "@/types/database";

const CATEGORIES = [
  { id: "tp1", name: "Display", type: "TP" as const, account_code: "TP1" },
  { id: "tp3", name: "Promo Toko", type: "TP" as const, account_code: "TP3" },
  { id: "cp1", name: "Consumer Promo", type: "CP" as const, account_code: "CP1" },
];

function zeroActuals(): RegionActual[] {
  return REGION_CONTRIBUTIONS.map((r) => ({ name: r.name, amount: 0 }));
}

function actualsFor(overrides: Record<string, number>): RegionActual[] {
  return REGION_CONTRIBUTIONS.map((r) => ({ name: r.name, amount: overrides[r.name] ?? 0 }));
}

function campaign(
  categoryId: string | null,
  budget: number,
  startDate: string,
  status: CampaignStatus = "approved",
  regionName: string | null = null
): MonitoringCampaign {
  return {
    promotion_category_id: categoryId,
    requested_budget: budget,
    status,
    start_date: startDate,
    region_name: regionName,
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
      // Kedua kategori TP di sini punya budget kelipatan yang membulat pas
      // (1000 & 500), jadi hasil sum-per-baris = allocateBudgetByRegion(1500).
      regionAllocations: allocateBudgetByRegion(1500),
      // Tidak ada campaign yang region_name-nya diisi di test ini → nol semua.
      regionActuals: zeroActuals(),
    });
    expect(result.totalCP).toEqual({
      budget: 2000,
      months: [0, 0, 300],
      total: 300,
      variance: 1700,
      regionAllocations: allocateBudgetByRegion(2000),
      regionActuals: zeroActuals(),
    });
    expect(result.grandTotal).toEqual({
      budget: 3500,
      months: [100, 700, 300],
      total: 1100,
      variance: 2400,
      regionAllocations: allocateBudgetByRegion(3500),
      regionActuals: zeroActuals(),
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

  it("menjumlahkan requested_budget SKP ke regionActuals per kategori berdasarkan region_name asli, mengecualikan region di luar 5 wilayah", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [{ promotion_category_id: "tp1", total_amount: 1000 }],
      campaigns: [
        campaign("tp1", 100, "2026-07-05", "approved", "Greater Jakarta"),
        campaign("tp1", 50, "2026-08-10", "paid", "Greater Jakarta"),
        campaign("tp1", 200, "2026-09-01", "completed", "West Kalimantan"),
        // "National" bukan salah satu dari 5 wilayah tetap → dikecualikan
        campaign("tp1", 999, "2026-07-15", "approved", "National"),
        // region kosong → dikecualikan
        campaign("tp1", 999, "2026-07-20", "approved", null),
      ],
    });

    const row = result.tpRows[0];
    expect(row.regionActuals).toEqual(actualsFor({ "Greater Jakarta": 150, "West Kalimantan": 200 }));
    // Total Actual & months tetap menghitung semua SKP komitmen di kuartal ini,
    // termasuk yang region-nya dikecualikan dari breakdown region.
    expect(row.total).toBe(100 + 50 + 200 + 999 + 999);
  });

  it("regionActuals baris Tanpa Kategori & subtotal konsisten dengan sum baris kategori", () => {
    const result = aggregateMonitoringBudget({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [],
      campaigns: [
        campaign("tp3", 400, "2026-07-15", "approved", "East Java & Bali"),
        campaign(null, 250, "2026-08-20", "approved", "East Java & Bali"),
      ],
    });

    expect(result.tpRows[0].regionActuals).toEqual(actualsFor({ "East Java & Bali": 400 }));
    expect(result.uncategorized!.regionActuals).toEqual(actualsFor({ "East Java & Bali": 250 }));
    // grandTotal = TP + Tanpa Kategori
    expect(result.grandTotal.regionActuals).toEqual(actualsFor({ "East Java & Bali": 650 }));
  });
});

describe("summarizeExcludedRegion", () => {
  it("menjumlahkan SKP komitmen dalam kuartal yang region-nya bukan salah satu dari 5 wilayah tetap", () => {
    const result = summarizeExcludedRegion(
      [
        campaign("tp1", 100, "2026-07-05", "approved", "National"),
        campaign("tp1", 200, "2026-08-05", "approved", null),
        // masuk salah satu dari 5 wilayah → tidak terhitung
        campaign("tp1", 300, "2026-07-01", "approved", "Greater Jakarta"),
        // status non-komitmen → tidak terhitung meski region National
        campaign("tp1", 999, "2026-07-01", "draft", "National"),
        // di luar kuartal → tidak terhitung
        campaign("tp1", 999, "2026-06-30", "approved", "National"),
      ],
      2026,
      2
    );
    expect(result).toEqual({ count: 2, total: 300 });
  });

  it("mengembalikan nol jika semua SKP komitmen ber-region salah satu dari 5 wilayah tetap", () => {
    const result = summarizeExcludedRegion(
      [campaign("tp1", 100, "2026-07-01", "approved", "Greater Jakarta")],
      2026,
      2
    );
    expect(result).toEqual({ count: 0, total: 0 });
  });
});

describe("allocateBudgetByRegion", () => {
  it("memecah budget kategori jadi 5 region sesuai persentase kontribusi tetap", () => {
    const result = allocateBudgetByRegion(2_000_000_000);
    expect(result).toEqual([
      { name: "Greater Jakarta", percentage: 0.28, amount: 560_000_000 },
      { name: "West & Central Java", percentage: 0.22, amount: 440_000_000 },
      { name: "East Java & Bali", percentage: 0.20, amount: 400_000_000 },
      { name: "North Sumatera etc", percentage: 0.20, amount: 400_000_000 },
      { name: "West Kalimantan", percentage: 0.10, amount: 200_000_000 },
    ]);
  });

  it("persentase kontribusi region berjumlah 100%", () => {
    const total = REGION_CONTRIBUTIONS.reduce((s, r) => s + r.percentage, 0);
    expect(total).toBeCloseTo(1);
  });

  it("membulatkan tiap region secara independen (Math.round, bukan largest-remainder)", () => {
    const result = allocateBudgetByRegion(1_104_509_314);
    // 1_104_509_314 * 0.22 = 242_992_049.08 → dibulatkan
    expect(result[1].amount).toBe(242_992_049);
  });

  it("budget nol menghasilkan alokasi nol di semua region", () => {
    const result = allocateBudgetByRegion(0);
    expect(result.every((r) => r.amount === 0)).toBe(true);
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
      { requested_budget: 200, status: "ongoing", start_date: null },
      // punya start_date → tidak terhitung
      campaign("tp1", 300, "2026-07-01", "approved"),
      // status non-komitmen tanpa start_date → tidak terhitung
      { requested_budget: 999, status: "draft", start_date: null },
    ]);
    expect(result).toEqual({ count: 2, total: 300 });
  });

  it("mengembalikan nol jika semua SKP komitmen punya start_date", () => {
    const result = summarizeMissingStartDate([campaign("tp1", 100, "2026-07-01", "approved")]);
    expect(result).toEqual({ count: 0, total: 0 });
  });
});

function realization(
  categoryId: string | null,
  amount: number,
  realizationDate: string,
  campaignStatus: CampaignStatus = "paid"
): MonitoringRealization {
  return {
    promotion_category_id: categoryId,
    amount,
    realization_date: realizationDate,
    campaign_status: campaignStatus,
  };
}

describe("aggregateMonitoringBudgetRealisasi", () => {
  it("menjumlahkan nilai invoice ke bucket bulan realization_date, mengecualikan SKP cancelled", () => {
    const result = aggregateMonitoringBudgetRealisasi({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [{ promotion_category_id: "tp1", total_amount: 1000 }],
      realizations: [
        realization("tp1", 100, "2026-07-05"),
        realization("tp1", 200, "2026-08-10"),
        // milik SKP cancelled tidak terhitung meski realization_date di kuartal ini
        realization("tp1", 999, "2026-08-15", "cancelled"),
        // di luar kuartal tidak terhitung
        realization("tp1", 999, "2026-06-30"),
      ],
      campaigns: [],
    });

    expect(result.tpRows).toHaveLength(1);
    const row = result.tpRows[0];
    expect(row.accountCode).toBe("TP1");
    expect(row.months).toEqual([100, 200, 0]);
    expect(row.total).toBe(300);
    expect(row.budget).toBe(1000);
    expect(row.variance).toBe(700);
  });

  it("struktur hasil (subtotal, tanpa kategori, budget 0) sama dengan mode komitmen", () => {
    const result = aggregateMonitoringBudgetRealisasi({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [],
      realizations: [
        realization("tp3", 400, "2026-07-15"),
        realization(null, 250, "2026-08-20"),
      ],
      campaigns: [],
    });

    expect(result.tpRows.map((r) => r.accountCode)).toEqual(["TP3"]);
    expect(result.tpRows[0].budget).toBe(0);
    expect(result.tpRows[0].variance).toBe(-400);
    expect(result.uncategorized).not.toBeNull();
    expect(result.uncategorized!.months).toEqual([0, 250, 0]);
    expect(result.grandTotal.total).toBe(650);
  });

  it("regionActuals selalu dari requested_budget campaigns, BUKAN dari nilai invoice realizations", () => {
    const result = aggregateMonitoringBudgetRealisasi({
      fiscalYear: 2026,
      quarter: 2,
      categories: CATEGORIES,
      budgets: [{ promotion_category_id: "tp1", total_amount: 1000 }],
      // invoice realisasi sengaja beda nilai & bulan dari campaigns di bawah
      realizations: [realization("tp1", 999_999, "2026-08-10")],
      campaigns: [
        campaign("tp1", 150, "2026-07-05", "approved", "Greater Jakarta"),
        campaign("tp1", 200, "2026-09-01", "paid", "West Kalimantan"),
      ],
    });

    const row = result.tpRows[0];
    // months/total tetap dari realizations (999_999 di Agustus)
    expect(row.months).toEqual([0, 999_999, 0]);
    // tapi regionActuals dari requested_budget campaigns, bukan realizations
    expect(row.regionActuals).toEqual(actualsFor({ "Greater Jakarta": 150, "West Kalimantan": 200 }));
  });
});

function drilldownCampaign(
  id: string,
  categoryId: string | null,
  budget: number,
  startDate: string | null,
  status: CampaignStatus = "approved"
): DrilldownCampaignInput {
  return {
    id,
    skp_number: `SKP-${id}`,
    name: `Campaign ${id}`,
    brand_name: "Brand X",
    requested_budget: budget,
    status,
    start_date: startDate,
    promotion_category_id: categoryId,
  };
}

describe("buildKomitmenDrilldown", () => {
  it("mengelompokkan SKP komitmen per kategori+bulan, total cocok dengan sel agregat", () => {
    const campaigns = [
      drilldownCampaign("1", "tp1", 100, "2026-07-05"),
      drilldownCampaign("2", "tp1", 200, "2026-07-20", "ongoing"),
      drilldownCampaign("3", "tp1", 300, "2026-08-10", "paid"),
      // status non-komitmen tidak ikut
      drilldownCampaign("4", "tp1", 999, "2026-07-01", "cancelled"),
      // di luar kuartal tidak ikut
      drilldownCampaign("5", "tp1", 999, "2026-06-30"),
      // tanpa start_date tidak ikut
      drilldownCampaign("6", "tp1", 999, null),
    ];

    const result = buildKomitmenDrilldown({ fiscalYear: 2026, quarter: 2, campaigns });

    const julKey = drilldownKey("tp1", 0);
    expect(result[julKey]).toHaveLength(2);
    expect(result[julKey].map((i) => i.id)).toEqual(["1", "2"]);
    const julTotal = result[julKey].reduce((s, i) => s + i.requestedBudget, 0);
    expect(julTotal).toBe(300); // cocok dengan row.months[0] pada test agregasi di atas

    const agsKey = drilldownKey("tp1", 1);
    expect(result[agsKey]).toHaveLength(1);
    expect(result[agsKey][0].skpNumber).toBe("SKP-3");

    // bulan tanpa item tidak punya entry
    expect(result[drilldownKey("tp1", 2)]).toBeUndefined();
  });

  it("mengelompokkan SKP tanpa kategori di key \"\"", () => {
    const campaigns = [drilldownCampaign("1", null, 250, "2026-08-20")];
    const result = buildKomitmenDrilldown({ fiscalYear: 2026, quarter: 2, campaigns });
    expect(result[drilldownKey(null, 1)]).toHaveLength(1);
  });
});

function drilldownRealization(
  id: string,
  categoryId: string | null,
  amount: number,
  realizationDate: string,
  campaignStatus: CampaignStatus = "paid"
): DrilldownRealizationInput {
  return {
    id,
    invoice_number: `INV-${id}`,
    campaign_name: `Campaign ${id}`,
    amount,
    realization_date: realizationDate,
    campaign_status: campaignStatus,
    promotion_category_id: categoryId,
  };
}

describe("buildRealisasiDrilldown", () => {
  it("mengelompokkan invoice per kategori+bulan, mengecualikan SKP cancelled", () => {
    const realizations = [
      drilldownRealization("1", "tp1", 100, "2026-07-05"),
      drilldownRealization("2", "tp1", 200, "2026-08-10"),
      drilldownRealization("3", "tp1", 999, "2026-08-15", "cancelled"),
      drilldownRealization("4", "tp1", 999, "2026-06-30"),
    ];

    const result = buildRealisasiDrilldown({ fiscalYear: 2026, quarter: 2, realizations });

    expect(result[drilldownKey("tp1", 0)]).toHaveLength(1);
    expect(result[drilldownKey("tp1", 0)][0].invoiceNumber).toBe("INV-1");
    expect(result[drilldownKey("tp1", 1)]).toHaveLength(1);
    expect(result[drilldownKey("tp1", 1)][0].amount).toBe(200);
  });

  it("mengelompokkan invoice tanpa kategori di key \"\"", () => {
    const realizations = [drilldownRealization("1", null, 250, "2026-08-20")];
    const result = buildRealisasiDrilldown({ fiscalYear: 2026, quarter: 2, realizations });
    expect(result[drilldownKey(null, 1)]).toHaveLength(1);
  });
});

describe("resolveMonitoringMode", () => {
  it("mengembalikan 'realisasi' hanya jika parameter persis 'realisasi'", () => {
    expect(resolveMonitoringMode("realisasi")).toBe("realisasi");
  });

  it("default ke 'komitmen' untuk parameter kosong atau tidak dikenal", () => {
    expect(resolveMonitoringMode(undefined)).toBe("komitmen");
    expect(resolveMonitoringMode("komitmen")).toBe("komitmen");
    expect(resolveMonitoringMode("apapun")).toBe("komitmen");
  });
});

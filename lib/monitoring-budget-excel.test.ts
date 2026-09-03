import { describe, it, expect } from "vitest";
import type ExcelJS from "exceljs";
import { buildMonitoringBudgetWorkbook } from "./monitoring-budget-excel";
import {
  allocateBudgetByRegion,
  REGION_CONTRIBUTIONS,
  type MonitoringAggregate,
  type RegionActual,
} from "./monitoring-budget";

function zeroActuals(): RegionActual[] {
  return REGION_CONTRIBUTIONS.map((r) => ({ name: r.name, amount: 0 }));
}

function actualsFor(overrides: Record<string, number>): RegionActual[] {
  return REGION_CONTRIBUTIONS.map((r) => ({ name: r.name, amount: overrides[r.name] ?? 0 }));
}

function aggregate(overrides: Partial<MonitoringAggregate> = {}): MonitoringAggregate {
  return {
    fiscalYear: 2026,
    quarter: 2,
    monthLabels: ["Juli 2026", "Agustus 2026", "September 2026"],
    tpRows: [],
    cpRows: [],
    uncategorized: null,
    totalTP: { budget: 0, months: [0, 0, 0], total: 0, variance: 0, regionAllocations: allocateBudgetByRegion(0), regionActuals: zeroActuals() },
    totalCP: { budget: 0, months: [0, 0, 0], total: 0, variance: 0, regionAllocations: allocateBudgetByRegion(0), regionActuals: zeroActuals() },
    grandTotal: { budget: 0, months: [0, 0, 0], total: 0, variance: 0, regionAllocations: allocateBudgetByRegion(0), regionActuals: zeroActuals() },
    ...overrides,
  };
}

function sheet(agg: MonitoringAggregate, mode: "komitmen" | "realisasi" = "komitmen") {
  const wb = buildMonitoringBudgetWorkbook(agg, mode);
  return wb.worksheets[0];
}

describe("buildMonitoringBudgetWorkbook — judul", () => {
  it("menulis judul 'Monitoring Budget Q2 2026' di baris pertama", () => {
    const ws = sheet(aggregate({ fiscalYear: 2026, quarter: 2 }));
    expect(String(ws.getCell("A1").value)).toBe("Monitoring Budget Q2 2026");
  });

  it("mengikuti kuartal dan tahun fiskal yang diberikan", () => {
    const ws = sheet(aggregate({ fiscalYear: 2027, quarter: 4 }));
    expect(String(ws.getCell("A1").value)).toBe("Monitoring Budget Q4 2027");
  });
});

describe("buildMonitoringBudgetWorkbook — header", () => {
  it("merge header 'Spending Budget' di atas 3 kolom bulan dan menulis label bulan di baris bawahnya", () => {
    const ws = sheet(
      aggregate({ monthLabels: ["Juli 2026", "Agustus 2026", "September 2026"] })
    );
    const headerRow = ws.getRow(3);
    expect(String(headerRow.getCell(3).value)).toBe("Spending Budget");
    // C3:E3 merged: D3 and E3 report C3 as their master cell.
    expect(ws.getCell("D3").master).toBe(ws.getCell("C3"));
    expect(ws.getCell("E3").master).toBe(ws.getCell("C3"));

    const monthRow = ws.getRow(4);
    expect(String(monthRow.getCell(3).value)).toBe("Juli 2026");
    expect(String(monthRow.getCell(4).value)).toBe("Agustus 2026");
    expect(String(monthRow.getCell(5).value)).toBe("September 2026");
  });

  it("merge header 'Alokasi Budget by Region' dan 'Realisasi By Region' masing-masing di atas 6 kolom (5 wilayah + Nasional), nama region di baris bawahnya", () => {
    const ws = sheet(aggregate());
    const headerRow = ws.getRow(3);
    expect(String(headerRow.getCell(8).value)).toBe("Alokasi Budget by Region");
    expect(ws.getCell("M3").master).toBe(ws.getCell("H3")); // col 8-13 merged
    expect(String(headerRow.getCell(14).value)).toBe("Realisasi By Region");
    expect(ws.getCell("S3").master).toBe(ws.getCell("N3")); // col 14-19 merged

    const nameRow = ws.getRow(4);
    expect(String(nameRow.getCell(8).value)).toBe("Greater Jakarta");
    expect(String(nameRow.getCell(12).value)).toBe("West Kalimantan");
    expect(String(nameRow.getCell(13).value)).toBe("Nasional");
    expect(String(nameRow.getCell(14).value)).toBe("Greater Jakarta");
    expect(String(nameRow.getCell(18).value)).toBe("West Kalimantan");
    expect(String(nameRow.getCell(19).value)).toBe("Nasional");
  });
});

describe("buildMonitoringBudgetWorkbook — baris kategori & subtotal", () => {
  it("menulis baris kategori TP dan subtotal Total TP dengan nilai yang sesuai", () => {
    const ws = sheet(
      aggregate({
        tpRows: [
          {
            categoryId: "tp1",
            accountCode: "TP1",
            name: "Display",
            type: "TP",
            budget: 1_000_000,
            months: [100_000, 200_000, 300_000],
            total: 600_000,
            variance: 400_000,
            regionAllocations: allocateBudgetByRegion(1_000_000),
            regionActuals: actualsFor({ "Greater Jakarta": 90_000, "West Kalimantan": 10_000 }),
          },
        ],
        totalTP: {
          budget: 1_000_000,
          months: [100_000, 200_000, 300_000],
          total: 600_000,
          variance: 400_000,
          regionAllocations: allocateBudgetByRegion(1_000_000),
          regionActuals: actualsFor({ "Greater Jakarta": 90_000, "West Kalimantan": 10_000 }),
        },
      })
    );

    // Baris 1: judul, baris 2: subjudul mode, baris 3-4: header, baris 5: kategori TP1, baris 6: Total TP
    const catRow = ws.getRow(5);
    expect(String(catRow.getCell(1).value)).toContain("Display");
    expect(catRow.getCell(2).value).toBe(1_000_000);
    expect(catRow.getCell(3).value).toBe(100_000);
    expect(catRow.getCell(6).value).toBe(600_000);
    expect(catRow.getCell(7).value).toBe(400_000);
    // Kolom 8-13: Alokasi Budget by Region (target, termasuk Nasional 0%)
    expect(catRow.getCell(8).value).toBe(280_000); // Greater Jakarta 28% dari 1.000.000
    expect(catRow.getCell(12).value).toBe(100_000); // West Kalimantan 10% dari 1.000.000
    expect(catRow.getCell(13).value).toBe(0); // Nasional 0%
    // Kolom 14-19: Realisasi By Region (actual)
    expect(catRow.getCell(14).value).toBe(90_000); // Greater Jakarta
    expect(catRow.getCell(18).value).toBe(10_000); // West Kalimantan

    const totalRow = ws.getRow(6);
    expect(String(totalRow.getCell(1).value)).toBe("Total TP");
    expect(totalRow.getCell(2).value).toBe(1_000_000);
    expect(totalRow.getCell(7).value).toBe(400_000);
    expect(totalRow.getCell(8).value).toBe(280_000);
    expect(totalRow.getCell(14).value).toBe(90_000);
    // Baris subtotal diberi latar
    expect(totalRow.getCell(1).fill).toBeDefined();
  });

  it("menyertakan baris 'Tanpa Kategori' hanya jika ada, di luar subtotal TP/CP", () => {
    const withUncat = sheet(
      aggregate({
        uncategorized: {
          categoryId: null,
          accountCode: null,
          name: "Tanpa Kategori",
          type: null,
          budget: 0,
          months: [0, 0, 50_000],
          total: 50_000,
          variance: -50_000,
          regionAllocations: allocateBudgetByRegion(0),
          regionActuals: zeroActuals(),
        },
      })
    );
    const rows: string[] = [];
    withUncat.eachRow((row) => rows.push(String(row.getCell(1).value)));
    expect(rows).toContain("Tanpa Kategori");

    const withoutUncat = sheet(aggregate({ uncategorized: null }));
    const rows2: string[] = [];
    withoutUncat.eachRow((row) => rows2.push(String(row.getCell(1).value)));
    expect(rows2).not.toContain("Tanpa Kategori");
  });
});

describe("buildMonitoringBudgetWorkbook — variance & styling", () => {
  it("memformat variance negatif dengan warna merah dan tanda minus", () => {
    const ws = sheet(
      aggregate({
        cpRows: [
          {
            categoryId: "cp1",
            accountCode: "CP1",
            name: "Consumer Promo",
            type: "CP",
            budget: 0,
            months: [0, 0, 100_000],
            total: 100_000,
            variance: -100_000,
            regionAllocations: allocateBudgetByRegion(0),
            regionActuals: zeroActuals(),
          },
        ],
      })
    );
    // Baris 5 = "Total TP" (selalu ditulis walau tpRows kosong), baris 6 = kategori CP.
    const catRow = ws.getRow(6);
    const varianceCell = catRow.getCell(7);
    expect(varianceCell.value).toBe(-100_000);
    expect(String(varianceCell.numFmt)).toMatch(/Red/);
    expect(String(varianceCell.numFmt)).toMatch(/-/);
  });

  it("menyorot kolom Budget dengan fill", () => {
    const ws = sheet(
      aggregate({
        tpRows: [
          {
            categoryId: "tp1",
            accountCode: "TP1",
            name: "Display",
            type: "TP",
            budget: 500_000,
            months: [0, 0, 0],
            total: 0,
            variance: 500_000,
            regionAllocations: allocateBudgetByRegion(500_000),
            regionActuals: zeroActuals(),
          },
        ],
      })
    );
    const headerBudgetCell = ws.getRow(3).getCell(2);
    const dataBudgetCell = ws.getRow(5).getCell(2);
    expect(headerBudgetCell.fill).toBeDefined();
    expect(dataBudgetCell.fill).toBeDefined();
  });

  it("grand total mendapat latar berbeda dari subtotal TP/CP", () => {
    const ws = sheet(
      aggregate({
        tpRows: [
          {
            categoryId: "tp1",
            accountCode: "TP1",
            name: "Display",
            type: "TP",
            budget: 100,
            months: [0, 0, 0],
            total: 0,
            variance: 100,
            regionAllocations: allocateBudgetByRegion(100),
            regionActuals: zeroActuals(),
          },
        ],
        totalTP: { budget: 100, months: [0, 0, 0], total: 0, variance: 100, regionAllocations: allocateBudgetByRegion(100), regionActuals: zeroActuals() },
        grandTotal: { budget: 100, months: [0, 0, 0], total: 0, variance: 100, regionAllocations: allocateBudgetByRegion(100), regionActuals: zeroActuals() },
      })
    );
    let grandTotalRow: ExcelJS.Row | undefined;
    ws.eachRow((row) => {
      if (String(row.getCell(1).value) === "Total TP CP") grandTotalRow = row;
    });
    expect(grandTotalRow).toBeDefined();
    const fill = grandTotalRow!.getCell(1).fill as { fgColor?: { argb?: string } };
    const totalTPFill = ws.getRow(6).getCell(1).fill as { fgColor?: { argb?: string } };
    expect(fill.fgColor?.argb).not.toBe(totalTPFill.fgColor?.argb);
  });
});

describe("buildMonitoringBudgetWorkbook — mode", () => {
  it("menulis label mode Komitmen atau Realisasi di baris kedua", () => {
    const komitmen = sheet(aggregate(), "komitmen");
    expect(String(komitmen.getCell("A2").value)).toMatch(/Komitmen/);

    const realisasi = sheet(aggregate(), "realisasi");
    expect(String(realisasi.getCell("A2").value)).toMatch(/Realisasi/);
  });
});

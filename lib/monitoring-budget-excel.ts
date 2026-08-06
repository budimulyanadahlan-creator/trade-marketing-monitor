import ExcelJS from "exceljs";
import type {
  MonitoringAggregate,
  MonitoringMode,
  MonitoringRow,
  MonitoringTotals,
} from "./monitoring-budget";

// Format ribuan gaya Indonesia: kode format Excel bawaan (locale-invariant di
// file), separator titik/koma dirender otomatis oleh Excel sesuai locale
// sistem yang membukanya. Variance negatif → merah dengan tanda minus.
const NUMBER_FORMAT = "#,##0";
const VARIANCE_FORMAT = "#,##0;[Red]-#,##0";

const BUDGET_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF2CC" }, // kuning muda — menyorot kolom Budget
};
const SUBTOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" }, // abu muda — baris Total TP / Total CP
};
const GRAND_TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9F2E6" }, // hijau muda — baris Total TP CP
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

const COL_COUNT = 7; // Kategori, Budget, 3 bulan, Total Actual, Variance

function categoryLabel(row: MonitoringRow): string {
  return row.accountCode ? `${row.accountCode} ${row.name}` : row.name;
}

function writeDataRow(ws: ExcelJS.Worksheet, label: string, values: number[]): ExcelJS.Row {
  const row = ws.addRow([label, ...values]);
  for (let col = 2; col <= COL_COUNT; col++) {
    const cell = row.getCell(col);
    cell.numFmt = col === COL_COUNT ? VARIANCE_FORMAT : NUMBER_FORMAT;
    cell.border = THIN_BORDER;
  }
  row.getCell(1).border = THIN_BORDER;
  row.getCell(2).fill = BUDGET_FILL; // sorotan kolom Budget di setiap baris data
  return row;
}

function writeTotalsRow(
  ws: ExcelJS.Worksheet,
  label: string,
  totals: MonitoringTotals,
  fill: ExcelJS.Fill
): void {
  const row = writeDataRow(ws, label, [
    totals.budget,
    ...totals.months,
    totals.total,
    totals.variance,
  ]);
  row.font = { bold: true };
  for (let col = 1; col <= COL_COUNT; col++) {
    row.getCell(col).fill = fill;
  }
}

export function buildMonitoringBudgetWorkbook(
  aggregate: MonitoringAggregate,
  mode: MonitoringMode
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Monitoring Budget");

  ws.columns = [
    { width: 32 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  // Judul
  ws.mergeCells(1, 1, 1, COL_COUNT);
  const titleCell = ws.getCell("A1");
  titleCell.value = `Monitoring Budget Q${aggregate.quarter} ${aggregate.fiscalYear}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  // Subjudul mode
  ws.mergeCells(2, 1, 2, COL_COUNT);
  const modeCell = ws.getCell("A2");
  modeCell.value =
    mode === "realisasi" ? "Mode Realisasi (invoice)" : "Mode Komitmen (SKP disetujui)";
  modeCell.font = { italic: true, color: { argb: "FF666666" } };
  modeCell.alignment = { horizontal: "center" };

  // Header baris 3-4
  const headerRow1 = ws.getRow(3);
  const headerRow2 = ws.getRow(4);

  ws.mergeCells(3, 1, 4, 1); // Kategori
  headerRow1.getCell(1).value = "Kategori";
  ws.mergeCells(3, 2, 4, 2); // Budget
  headerRow1.getCell(2).value = "Budget (IDR)";
  ws.mergeCells(3, 3, 3, 5); // Spending Budget di atas 3 kolom bulan
  headerRow1.getCell(3).value = "Spending Budget";
  ws.mergeCells(3, 6, 4, 6); // Total Actual
  headerRow1.getCell(6).value = "Total Actual";
  ws.mergeCells(3, 7, 4, 7); // Variance
  headerRow1.getCell(7).value = "Variance";

  aggregate.monthLabels.forEach((label, i) => {
    headerRow2.getCell(3 + i).value = label;
  });

  for (const row of [headerRow1, headerRow2]) {
    for (let col = 1; col <= COL_COUNT; col++) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      cell.alignment = { horizontal: col === 1 ? "left" : "center", vertical: "middle" };
      cell.border = THIN_BORDER;
      cell.fill = col === 2 ? BUDGET_FILL : HEADER_FILL;
    }
  }

  // Baris kategori TP
  for (const row of aggregate.tpRows) {
    writeDataRow(ws, categoryLabel(row), [row.budget, ...row.months, row.total, row.variance]);
  }
  writeTotalsRow(ws, "Total TP", aggregate.totalTP, SUBTOTAL_FILL);

  // Baris kategori CP
  for (const row of aggregate.cpRows) {
    writeDataRow(ws, categoryLabel(row), [row.budget, ...row.months, row.total, row.variance]);
  }
  writeTotalsRow(ws, "Total CP", aggregate.totalCP, SUBTOTAL_FILL);

  // Tanpa Kategori (di luar subtotal TP/CP, hanya jika ada)
  if (aggregate.uncategorized) {
    const u = aggregate.uncategorized;
    writeDataRow(ws, u.name, [u.budget, ...u.months, u.total, u.variance]);
  }

  writeTotalsRow(ws, "Total TP CP", aggregate.grandTotal, GRAND_TOTAL_FILL);

  return wb;
}

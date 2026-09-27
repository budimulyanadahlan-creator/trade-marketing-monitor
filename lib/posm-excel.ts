import ExcelJS from "exceljs";
import {
  ASSET_DESTINATION_LABELS,
  monthLabel,
  POSM_MOVEMENT_LABELS,
  summarizeAssets,
  type OutRekap,
  type PosmStockStatus,
} from "./posm";
import type {
  AssetCondition,
  AssetDestination,
  AssetType,
  PosmCategory,
  PosmMovementType,
  PosmUnit,
} from "@/types/database";

// Pola format sama dengan lib/monitoring-budget-excel.ts.
const NUMBER_FORMAT = "#,##0";
const DATE_FORMAT = "dd mmm yyyy";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8E8E8" },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9F2E6" }, // hijau muda — baris Total
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

const STOCK_STATUS_LABELS: Record<PosmStockStatus, string> = {
  aman: "Aman",
  menipis: "Menipis",
  habis: "Habis",
};

export type PosmBalanceExportRow = {
  code: string;
  name: string;
  brand_name: string | null;
  category: PosmCategory;
  unit: PosmUnit;
  balance: number;
  min_stock: number | null;
  stock_status: PosmStockStatus;
  is_active: boolean;
  last_movement_date: string | null;
};

export type PosmMovementExportRow = {
  movement_date: string;
  item_code: string;
  item_name: string;
  unit: string;
  type: PosmMovementType;
  quantity: number;
  region_name: string | null;
  distributor_name: string | null;
  campaign_skp: string | null;
  campaign_name: string | null;
  notes: string | null;
  created_by_name: string | null;
};

/** Asset dengan kondisi & lokasi dari catatan penempatan terakhir. */
export type AssetExportRow = {
  code: string;
  name: string;
  asset_type: AssetType;
  brand_name: string | null;
  serial_number: string | null;
  acquisition_date: string;
  acquisition_value: number;
  condition: AssetCondition;
  destination: AssetDestination;
  region_name: string | null;
  distributor_name: string | null;
  store_name: string | null;
  last_event_date: string;
};

export type PosmExportData = {
  balances: PosmBalanceExportRow[];
  movements: PosmMovementExportRow[];
  /** Ringkasan filter aktif daftar mutasi, ditulis di atas tabel Mutasi. */
  movementFilterLabel: string;
  /** Rekap Keluar sesuai rentang bulan aktif (`months` = `YYYY-MM`). */
  rekap: OutRekap & { months: string[] };
  assets: AssetExportRow[];
};

type ColumnKind = "text" | "number" | "date";
type Column = { header: string; width: number; kind?: ColumnKind };

/** Tanggal `YYYY-MM-DD` sebagai Date UTC agar Excel menampilkannya sebagai tanggal. */
function excelDate(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatCell(cell: ExcelJS.Cell, kind: ColumnKind = "text") {
  cell.border = THIN_BORDER;
  if (kind === "number") cell.numFmt = NUMBER_FORMAT;
  if (kind === "date") cell.numFmt = DATE_FORMAT;
}

/**
 * Sheet tabel sederhana: header tebal, lebar kolom tetap, border tipis.
 * Dengan `caption`, keterangan ditulis di baris 1 dan header di baris 3.
 */
function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: Column[],
  rows: (string | number | Date | null)[][],
  caption?: string
): ExcelJS.Worksheet {
  const headerRow = caption ? 3 : 1;
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: headerRow }] });
  ws.columns = columns.map((c) => ({ width: c.width }));
  if (caption) {
    ws.addRow([caption]).getCell(1).font = { italic: true, color: { argb: "FF666666" } };
    ws.addRow([]);
  }

  const header = ws.addRow(columns.map((c) => c.header));
  header.font = { bold: true };
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: c.kind === "number" ? "right" : "left", vertical: "middle" };
  });

  for (const values of rows) {
    const row = ws.addRow(values);
    columns.forEach((c, i) => formatCell(row.getCell(i + 1), c.kind));
  }
  return ws;
}

function addBalanceSheet(wb: ExcelJS.Workbook, balances: PosmBalanceExportRow[]) {
  addTableSheet(
    wb,
    "Saldo POSM",
    [
      { header: "Kode", width: 14 },
      { header: "Nama Item", width: 32 },
      { header: "Brand", width: 18 },
      { header: "Kategori", width: 14 },
      { header: "Satuan", width: 10 },
      { header: "Saldo", width: 12, kind: "number" },
      { header: "Stok Minimum", width: 14, kind: "number" },
      { header: "Status Stok", width: 12 },
      { header: "Status Item", width: 12 },
      { header: "Terakhir Diperbarui", width: 18, kind: "date" },
    ],
    balances.map((b) => [
      b.code,
      b.name,
      b.brand_name,
      b.category,
      b.unit,
      b.balance,
      b.min_stock,
      STOCK_STATUS_LABELS[b.stock_status],
      b.is_active ? "Aktif" : "Nonaktif",
      excelDate(b.last_movement_date),
    ])
  );
}

function addMovementSheet(wb: ExcelJS.Workbook, movements: PosmMovementExportRow[], filterLabel: string) {
  addTableSheet(
    wb,
    "Mutasi",
    [
      { header: "Tanggal", width: 14, kind: "date" },
      { header: "Kode Item", width: 14 },
      { header: "Nama Item", width: 32 },
      { header: "Tipe", width: 14 },
      { header: "Qty", width: 10, kind: "number" },
      { header: "Satuan", width: 10 },
      { header: "Region", width: 18 },
      { header: "Distributor", width: 24 },
      { header: "No. SKP", width: 18 },
      { header: "Nama SKP", width: 30 },
      { header: "Keterangan", width: 36 },
      { header: "Dicatat Oleh", width: 20 },
    ],
    movements.map((m) => [
      excelDate(m.movement_date),
      m.item_code,
      m.item_name,
      POSM_MOVEMENT_LABELS[m.type],
      m.quantity,
      m.unit,
      m.region_name,
      m.distributor_name,
      m.campaign_skp,
      m.campaign_name,
      m.notes,
      m.created_by_name,
    ]),
    `Filter: ${filterLabel}`
  );
}

function addRekapSheet(wb: ExcelJS.Workbook, rekap: PosmExportData["rekap"]) {
  const { months, rows, monthTotals, grandTotal } = rekap;
  const period = months.length ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : "—";
  const ws = addTableSheet(
    wb,
    "Rekap Keluar per Region", // nama sheet Excel maksimal 31 karakter
    [
      { header: "Kode Item", width: 14 },
      { header: "Nama Item", width: 32 },
      { header: "Satuan", width: 10 },
      { header: "Region", width: 18 },
      ...months.map((m) => ({ header: monthLabel(m), width: 12, kind: "number" as const })),
      { header: "Total", width: 12, kind: "number" },
    ],
    rows.map((r) => [r.item_code, r.item_name, r.unit, r.region_name, ...r.months, r.total]),
    `Periode: ${period}`
  );

  const total = ws.addRow(["Total", null, null, null, ...monthTotals, grandTotal]);
  total.font = { bold: true };
  const colCount = 4 + months.length + 1;
  for (let col = 1; col <= colCount; col++) {
    const cell = total.getCell(col);
    formatCell(cell, col > 4 ? "number" : "text");
    cell.fill = TOTAL_FILL;
  }
}

function addAssetSheet(wb: ExcelJS.Workbook, assets: AssetExportRow[]) {
  const columns: Column[] = [
    { header: "Kode", width: 14 },
    { header: "Nama Asset", width: 28 },
    { header: "Jenis", width: 18 },
    { header: "Brand", width: 18 },
    { header: "No. Seri/Merk", width: 18 },
    { header: "Tgl Perolehan", width: 14, kind: "date" },
    { header: "Nilai Perolehan (Rp)", width: 20, kind: "number" },
    { header: "Kondisi", width: 16 },
    { header: "Lokasi", width: 14 },
    { header: "Region", width: 18 },
    { header: "Distributor", width: 24 },
    { header: "Nama Toko", width: 24 },
    { header: "Tgl Penempatan Terakhir", width: 22, kind: "date" },
  ];
  const ws = addTableSheet(
    wb,
    "Daftar Asset",
    columns,
    assets.map((a) => [
      a.code,
      a.name,
      a.asset_type,
      a.brand_name,
      a.serial_number,
      excelDate(a.acquisition_date),
      a.acquisition_value,
      a.condition,
      ASSET_DESTINATION_LABELS[a.destination],
      a.region_name,
      a.distributor_name,
      a.store_name,
      excelDate(a.last_event_date),
    ])
  );

  // Total mengikuti kartu ringkas tab Asset: asset Dihapusbukukan tidak dihitung.
  const { totalUnits, totalValue } = summarizeAssets(assets);
  const total = ws.addRow(["Total", `${totalUnits} unit (tanpa Dihapusbukukan)`, null, null, null, null, totalValue]);
  total.font = { bold: true };
  columns.forEach((c, i) => {
    const cell = total.getCell(i + 1);
    formatCell(cell, c.kind === "number" ? "number" : "text");
    cell.fill = TOTAL_FILL;
  });
}

export function buildPosmWorkbook(data: PosmExportData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  addBalanceSheet(wb, data.balances);
  addMovementSheet(wb, data.movements, data.movementFilterLabel);
  addRekapSheet(wb, data.rekap);
  addAssetSheet(wb, data.assets);
  return wb;
}

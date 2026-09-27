import type ExcelJS from "exceljs";
import { monthLabel, POSM_MOVEMENT_LABELS, type PosmStockStatus } from "./posm";
import {
  aggregateGimmickDestinationRekap,
  aggregateGimmickProgramRekap,
  aggregateGimmickRegionRekap,
  formatPcsWithCartons,
  GIMMICK_DESTINATION_LABELS,
  type GimmickRekapMatrix,
  type GimmickRekapMovement,
  type GimmickRekapMode,
} from "./gimmick";
import type { GimmickRekapData } from "./gimmick-rekap-data";
import {
  addTableSheet,
  excelDate,
  formatCell,
  HEADER_FILL,
  STOCK_STATUS_LABELS,
  TOTAL_FILL,
  type Column,
} from "./posm-excel";
import type { GimmickCategory, GimmickDestination, GimmickUnit, PosmMovementType } from "@/types/database";

// Sheet gimmick ditambahkan ke workbook export Monitoring POSM hanya untuk
// pemegang can_manage_posm(). Nama sheet Excel maksimal 31 karakter dan
// harus berbeda dari sheet POSM ("Rekap Keluar per Region").
export const GIMMICK_SHEET_NAMES = [
  "Saldo Gimmick",
  "Mutasi Gimmick",
  "Rekap Gimmick per Region",
  "Rekap Gimmick per Tujuan",
  "Rekap Gimmick per Program",
] as const;

export type GimmickBalanceExportRow = {
  code: string;
  name: string;
  program: string | null;
  brand_name: string | null;
  category: GimmickCategory;
  unit: GimmickUnit;
  pcs_per_carton: number | null;
  balance: number;
  unit_cost: number;
  /** Saldo × harga master terkini (dari view gimmick_stock_balances). */
  stock_value: number;
  min_stock: number | null;
  stock_status: PosmStockStatus;
  is_active: boolean;
  last_movement_date: string | null;
};

export type GimmickMovementExportRow = {
  movement_date: string;
  item_code: string;
  item_name: string;
  program: string | null;
  unit: string;
  pcs_per_carton: number | null;
  type: PosmMovementType;
  quantity: number;
  unit_cost_snapshot: number;
  destination: GimmickDestination | null;
  region_name: string | null;
  distributor_name: string | null;
  campaign_skp: string | null;
  campaign_name: string | null;
  recipient_name: string | null;
  notes: string | null;
  created_by_name: string | null;
};

export type GimmickExportData = {
  balances: GimmickBalanceExportRow[];
  movements: GimmickMovementExportRow[];
  /** Ringkasan filter aktif daftar mutasi, ditulis di atas tabel Mutasi Gimmick. */
  movementFilterLabel: string;
  /** Mutasi Keluar mentah untuk ketiga rekap; `filterLabel` = filter item/program ("" jika tidak ada). */
  rekap: GimmickRekapData & { filterLabel: string };
};

function addBalanceSheet(wb: ExcelJS.Workbook, balances: GimmickBalanceExportRow[]) {
  const columns: Column[] = [
    { header: "Kode", width: 14 },
    { header: "Nama Item", width: 32 },
    { header: "Program", width: 18 },
    { header: "Brand", width: 18 },
    { header: "Kategori", width: 14 },
    { header: "Satuan", width: 10 },
    { header: "Isi/Karton", width: 12, kind: "number" },
    { header: "Saldo (pcs)", width: 12, kind: "number" },
    { header: "Saldo (karton)", width: 24 },
    { header: "Harga Pokok (Rp)", width: 18, kind: "currency" },
    { header: "Nilai Stok (Rp)", width: 20, kind: "currency" },
    { header: "Stok Minimum", width: 14, kind: "number" },
    { header: "Status Stok", width: 12 },
    { header: "Status Item", width: 12 },
    { header: "Terakhir Diperbarui", width: 18, kind: "date" },
  ];
  const ws = addTableSheet(
    wb,
    GIMMICK_SHEET_NAMES[0],
    columns,
    balances.map((b) => [
      b.code,
      b.name,
      b.program,
      b.brand_name,
      b.category,
      b.unit,
      b.pcs_per_carton,
      b.balance,
      formatPcsWithCartons(b.balance, b.pcs_per_carton, b.unit),
      b.unit_cost,
      b.stock_value,
      b.min_stock,
      STOCK_STATUS_LABELS[b.stock_status],
      b.is_active ? "Aktif" : "Nonaktif",
      excelDate(b.last_movement_date),
    ])
  );

  // Sama dengan kartu "Total Nilai Stok": termasuk item nonaktif.
  const totalValue = balances.reduce((sum, b) => sum + b.stock_value, 0);
  const total = ws.addRow(["Total", null, null, null, null, null, null, null, null, null, totalValue]);
  total.font = { bold: true };
  columns.forEach((c, i) => {
    const cell = total.getCell(i + 1);
    formatCell(cell, c.kind === "currency" ? "currency" : "text");
    cell.fill = TOTAL_FILL;
  });
}

function addMovementSheet(wb: ExcelJS.Workbook, movements: GimmickMovementExportRow[], filterLabel: string) {
  addTableSheet(
    wb,
    GIMMICK_SHEET_NAMES[1],
    [
      { header: "Tanggal", width: 14, kind: "date" },
      { header: "Kode Item", width: 14 },
      { header: "Nama Item", width: 32 },
      { header: "Program", width: 18 },
      { header: "Tipe", width: 14 },
      { header: "Qty (pcs)", width: 10, kind: "number" },
      { header: "Qty (karton)", width: 24 },
      { header: "Satuan", width: 10 },
      { header: "Harga Snapshot (Rp)", width: 18, kind: "currency" },
      { header: "Nilai (Rp)", width: 18, kind: "currency" },
      { header: "Tujuan", width: 18 },
      { header: "Region", width: 18 },
      { header: "Distributor", width: 24 },
      { header: "No. SKP", width: 18 },
      { header: "Nama SKP", width: 30 },
      { header: "PIC/Penerima", width: 20 },
      { header: "Keterangan", width: 36 },
      { header: "Dicatat Oleh", width: 20 },
    ],
    movements.map((m) => [
      excelDate(m.movement_date),
      m.item_code,
      m.item_name,
      m.program,
      POSM_MOVEMENT_LABELS[m.type],
      m.quantity,
      formatPcsWithCartons(m.quantity, m.pcs_per_carton, m.unit),
      m.unit,
      m.unit_cost_snapshot,
      // Nilai transaksi = qty × harga snapshot (sama dengan daftar mutasi).
      m.quantity * m.unit_cost_snapshot,
      m.destination ? GIMMICK_DESTINATION_LABELS[m.destination] : null,
      m.region_name,
      m.distributor_name,
      m.campaign_skp,
      m.campaign_name,
      m.recipient_name,
      m.notes,
      m.created_by_name,
    ]),
    `Filter: ${filterLabel}`
  );
}

const REKAP_BLOCKS: { mode: GimmickRekapMode; title: string }[] = [
  { mode: "qty", title: "Qty (pcs)" },
  { mode: "value", title: "Nilai (Rp)" },
];

/**
 * Sheet rekap: satu blok Qty lalu satu blok Nilai (Rp), masing-masing
 * dengan kolom identitas, kolom per bulan, Total, dan baris Total.
 */
function addRekapSheet<Row>(
  wb: ExcelJS.Workbook,
  name: string,
  rekap: GimmickExportData["rekap"],
  matrices: Record<GimmickRekapMode, GimmickRekapMatrix<Row>>,
  identity: { header: string; width: number; value: (row: Row) => string | null }[]
) {
  const { months, filterLabel } = rekap;
  const period = months.length ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : "—";
  const ws = wb.addWorksheet(name);
  ws.columns = [
    ...identity.map((c) => ({ width: c.width })),
    ...months.map(() => ({ width: 14 })),
    { width: 16 },
  ];
  ws.addRow([`Periode: ${period}${filterLabel ? ` • ${filterLabel}` : ""}`]).getCell(1).font = {
    italic: true,
    color: { argb: "FF666666" },
  };

  const colCount = identity.length + months.length + 1;
  for (const { mode, title } of REKAP_BLOCKS) {
    const kind = mode === "value" ? "currency" : "number";
    const { rows, monthTotals, grandTotal } = matrices[mode];

    ws.addRow([]);
    ws.addRow([title]).font = { bold: true };

    const header = ws.addRow([...identity.map((c) => c.header), ...months.map(monthLabel), "Total"]);
    header.font = { bold: true };
    for (let col = 1; col <= colCount; col++) {
      const cell = header.getCell(col);
      formatCell(cell);
      cell.fill = HEADER_FILL;
    }

    for (const r of rows) {
      const row = ws.addRow([...identity.map((c) => c.value(r)), ...r.months, r.total]);
      for (let col = 1; col <= colCount; col++) formatCell(row.getCell(col), col > identity.length ? kind : "text");
    }

    const total = ws.addRow(["Total", ...identity.slice(1).map(() => null), ...monthTotals, grandTotal]);
    total.font = { bold: true };
    for (let col = 1; col <= colCount; col++) {
      const cell = total.getCell(col);
      formatCell(cell, col > identity.length ? kind : "text");
      cell.fill = TOTAL_FILL;
    }
  }
}

export function addGimmickSheets(wb: ExcelJS.Workbook, data: GimmickExportData) {
  addBalanceSheet(wb, data.balances);
  addMovementSheet(wb, data.movements, data.movementFilterLabel);

  const { months, movements } = data.rekap;
  const bothModes = <Row>(
    aggregate: (m: GimmickRekapMovement[], months: string[], mode: GimmickRekapMode) => GimmickRekapMatrix<Row>
  ) => ({ qty: aggregate(movements, months, "qty"), value: aggregate(movements, months, "value") });

  addRekapSheet(wb, GIMMICK_SHEET_NAMES[2], data.rekap, bothModes(aggregateGimmickRegionRekap), [
    { header: "Kode Item", width: 14, value: (r) => r.item_code },
    { header: "Nama Item", width: 32, value: (r) => r.item_name },
    { header: "Satuan", width: 10, value: (r) => r.unit },
    { header: "Region", width: 18, value: (r) => r.region_name },
  ]);
  addRekapSheet(wb, GIMMICK_SHEET_NAMES[3], data.rekap, bothModes(aggregateGimmickDestinationRekap), [
    { header: "Tujuan", width: 22, value: (r) => GIMMICK_DESTINATION_LABELS[r.destination] },
  ]);
  addRekapSheet(wb, GIMMICK_SHEET_NAMES[4], data.rekap, bothModes(aggregateGimmickProgramRekap), [
    { header: "Program", width: 24, value: (r) => r.label },
  ]);
}

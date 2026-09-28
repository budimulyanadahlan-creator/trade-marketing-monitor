import ExcelJS from "exceljs";
import { EVENT_STATUS_LABELS } from "./event";
import { addTableSheet, excelDate, type Column } from "./posm-excel";
import type { EventStatus, EventType } from "@/types/database";

export const EVENT_SHEET_NAMES = ["Event", "Rincian Sampling"] as const;

/** Biaya event; hanya diisi untuk user internal (tidak pernah untuk distributor). */
export type EventCostExport = {
  planned_budget: number;
  actual_budget: number | null;
  planned_sample_budget: number;
  /** Total nilai Rp baris sampling aktif. */
  sampling_value: number;
  vendor_name: string | null;
};

export type EventExportRow = {
  /** Nomor urut di sheet Event; dirujuk sheet Rincian Sampling. */
  no: number;
  name: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  region_name: string | null;
  location: string;
  distributor_name: string | null;
  pic_name: string;
  brand_names: string[];
  skp_numbers: string[];
  status: EventStatus;
  target_participants: number;
  target_sales: number;
  actual_participants: number | null;
  actual_sales: number | null;
  cancel_reason: string | null;
  notes: string | null;
  needs_update: boolean;
  lacks_photo: boolean;
  costs?: EventCostExport;
};

export type EventSamplingExportRow = {
  event_no: number;
  event_name: string;
  start_date: string;
  region_name: string | null;
  product_name: string;
  quantity: number;
  unit: string;
  /** Nilai Rp; hanya untuk user internal. */
  value?: number;
};

export type EventExportData = {
  fiscalYear: number;
  quarter: number;
  filterLabel: string;
  /** false untuk distributor: kolom biaya, vendor, dan nilai sampling tidak ditulis. */
  showCosts: boolean;
  events: EventExportRow[];
  samplings: EventSamplingExportRow[];
};

type Cell = string | number | Date | null;
type EventColumn = Column & { value: (e: EventExportRow) => Cell };

function badges(e: EventExportRow): string | null {
  const labels = [e.needs_update && "Perlu update", e.lacks_photo && "Belum ada foto"].filter(Boolean);
  return labels.length ? labels.join(", ") : null;
}

const EVENT_COLUMNS: EventColumn[] = [
  { header: "No", width: 6, kind: "number", value: (e) => e.no },
  { header: "Nama Event", width: 32, value: (e) => e.name },
  { header: "Jenis", width: 20, value: (e) => e.event_type },
  { header: "Tanggal Mulai", width: 14, kind: "date", value: (e) => excelDate(e.start_date) },
  { header: "Tanggal Selesai", width: 14, kind: "date", value: (e) => excelDate(e.end_date) },
  { header: "Region", width: 18, value: (e) => e.region_name },
  { header: "Lokasi / Outlet", width: 28, value: (e) => e.location },
  { header: "Distributor", width: 24, value: (e) => e.distributor_name },
  { header: "PIC", width: 18, value: (e) => e.pic_name },
  { header: "Brand", width: 22, value: (e) => e.brand_names.join(", ") || null },
  { header: "No. SKP", width: 22, value: (e) => e.skp_numbers.join(", ") || null },
  { header: "Status", width: 12, value: (e) => EVENT_STATUS_LABELS[e.status] },
  { header: "Badge", width: 24, value: badges },
  { header: "Target Peserta", width: 14, kind: "number", value: (e) => e.target_participants },
  { header: "Peserta Aktual", width: 14, kind: "number", value: (e) => e.actual_participants },
  { header: "Target Sales (Rp)", width: 18, kind: "currency", value: (e) => e.target_sales },
  { header: "Hasil Sales (Rp)", width: 18, kind: "currency", value: (e) => e.actual_sales },
];

// Hanya untuk internal; distributor tidak pernah mendapat kolom ini.
const COST_COLUMNS: EventColumn[] = [
  { header: "Rencana Budget Event (Rp)", width: 22, kind: "currency", value: (e) => e.costs?.planned_budget ?? null },
  { header: "Realisasi Budget Event (Rp)", width: 22, kind: "currency", value: (e) => e.costs?.actual_budget ?? null },
  {
    header: "Rencana Budget Sample (Rp)",
    width: 22,
    kind: "currency",
    value: (e) => e.costs?.planned_sample_budget ?? null,
  },
  { header: "Nilai Sampling (Rp)", width: 20, kind: "currency", value: (e) => e.costs?.sampling_value ?? null },
  { header: "Vendor", width: 24, value: (e) => e.costs?.vendor_name ?? null },
];

const TRAILING_COLUMNS: EventColumn[] = [
  { header: "Alasan Batal", width: 28, value: (e) => e.cancel_reason },
  { header: "Keterangan", width: 36, value: (e) => e.notes },
];

const EMPTY_MESSAGE = "Tidak ada event untuk periode dan filter ini.";

function addEventSheet(wb: ExcelJS.Workbook, data: EventExportData, caption: string) {
  const columns = [...EVENT_COLUMNS, ...(data.showCosts ? COST_COLUMNS : []), ...TRAILING_COLUMNS];
  const ws = addTableSheet(
    wb,
    EVENT_SHEET_NAMES[0],
    columns,
    data.events.map((e) => columns.map((c) => c.value(e))),
    caption
  );
  if (!data.events.length) ws.addRow([EMPTY_MESSAGE]).getCell(1).font = { italic: true };
}

function addSamplingSheet(wb: ExcelJS.Workbook, data: EventExportData, caption: string) {
  const columns: Column[] = [
    { header: "No Event", width: 10, kind: "number" },
    { header: "Nama Event", width: 32 },
    { header: "Tanggal Mulai", width: 14, kind: "date" },
    { header: "Region", width: 18 },
    { header: "Produk", width: 32 },
    { header: "Qty", width: 10, kind: "number" },
    { header: "Satuan", width: 10 },
    ...(data.showCosts ? [{ header: "Nilai (Rp)", width: 18, kind: "currency" as const }] : []),
  ];
  addTableSheet(
    wb,
    EVENT_SHEET_NAMES[1],
    columns,
    data.samplings.map((s) => [
      s.event_no,
      s.event_name,
      excelDate(s.start_date),
      s.region_name,
      s.product_name,
      s.quantity,
      s.unit,
      ...(data.showCosts ? [s.value ?? null] : []),
    ]),
    caption
  );
}

/**
 * Workbook export Monitoring Event untuk kuartal dan filter aktif. Tanpa
 * `showCosts` (distributor), kolom biaya, vendor, dan nilai sampling tidak
 * ditulis sama sekali, meskipun datanya ikut terkirim.
 */
export function buildEventWorkbook(data: EventExportData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const caption = `Monitoring Event FY ${data.fiscalYear} Q${data.quarter} • Filter: ${data.filterLabel}`;
  addEventSheet(wb, data, caption);
  addSamplingSheet(wb, data, caption);
  return wb;
}

export function eventExportFilename(fiscalYear: number, quarter: number): string {
  return `monitoring-event-fy${fiscalYear}-q${quarter}.xlsx`;
}

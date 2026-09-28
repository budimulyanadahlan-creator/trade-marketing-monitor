import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildEventWorkbook,
  eventExportFilename,
  EVENT_SHEET_NAMES,
  type EventExportData,
  type EventExportRow,
} from "./event-excel";

function event(overrides: Partial<EventExportRow> = {}): EventExportRow {
  return {
    no: 1,
    name: "Senam Pagi Wangzai",
    event_type: "Senam/Olahraga",
    start_date: "2026-09-28",
    end_date: "2026-10-03",
    region_name: "Jawa Barat",
    location: "Lapangan Gasibu",
    distributor_name: "PT Distribusi Maju",
    pic_name: "Andi",
    brand_names: ["Wangzai", "Want Want"],
    skp_numbers: ["SKP-0007", "SKP-0009"],
    status: "terlaksana",
    target_participants: 500,
    target_sales: 10_000_000,
    actual_participants: 620,
    actual_sales: 12_500_000,
    cancel_reason: null,
    notes: "Kerja sama kelurahan",
    needs_update: false,
    lacks_photo: true,
    costs: {
      planned_budget: 5_000_000,
      actual_budget: 4_750_000,
      planned_sample_budget: 1_000_000,
      sampling_value: 900_000,
      vendor_name: "EO Kreatif",
    },
    ...overrides,
  };
}

function data(overrides: Partial<EventExportData> = {}): EventExportData {
  return {
    fiscalYear: 2026,
    quarter: 2,
    filterLabel: "Semua event",
    showCosts: true,
    events: [event()],
    samplings: [
      {
        event_no: 1,
        event_name: "Senam Pagi Wangzai",
        start_date: "2026-09-28",
        region_name: "Jawa Barat",
        product_name: "Wangzai Susu 125ml",
        quantity: 300,
        unit: "pcs",
        value: 900_000,
      },
    ],
    ...overrides,
  };
}

function headers(ws: ExcelJS.Worksheet, row: number): unknown[] {
  const values: unknown[] = [];
  ws.getRow(row).eachCell((cell) => values.push(cell.value));
  return values;
}

/** Sel di baris data pertama berdasarkan judul kolom (header di baris 3). */
function cellByHeader(ws: ExcelJS.Worksheet, header: string, row = 4) {
  const col = headers(ws, 3).indexOf(header);
  if (col < 0) throw new Error(`kolom ${header} tidak ada`);
  return ws.getRow(row).getCell(col + 1);
}

describe("buildEventWorkbook — internal", () => {
  const wb = buildEventWorkbook(data());

  it("adds the event and sampling sheets", () => {
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([...EVENT_SHEET_NAMES]);
    expect(EVENT_SHEET_NAMES).toEqual(["Event", "Rincian Sampling"]);
  });

  it("writes the period and filter caption above the event table", () => {
    expect(wb.getWorksheet("Event")!.getCell("A1").value).toBe(
      "Monitoring Event FY 2026 Q2 • Filter: Semua event"
    );
  });

  it("writes all event fields including status, badges, costs, and vendor", () => {
    const ws = wb.getWorksheet("Event")!;
    expect(cellByHeader(ws, "No").value).toBe(1);
    expect(cellByHeader(ws, "Nama Event").value).toBe("Senam Pagi Wangzai");
    expect(cellByHeader(ws, "Tanggal Mulai").value).toEqual(new Date(Date.UTC(2026, 8, 28)));
    expect(cellByHeader(ws, "Tanggal Selesai").value).toEqual(new Date(Date.UTC(2026, 9, 3)));
    expect(cellByHeader(ws, "Region").value).toBe("Jawa Barat");
    expect(cellByHeader(ws, "Brand").value).toBe("Wangzai, Want Want");
    expect(cellByHeader(ws, "No. SKP").value).toBe("SKP-0007, SKP-0009");
    expect(cellByHeader(ws, "Status").value).toBe("Terlaksana");
    expect(cellByHeader(ws, "Badge").value).toBe("Belum ada foto");
    expect(cellByHeader(ws, "Target Sales (Rp)").value).toBe(10_000_000);
    expect(cellByHeader(ws, "Target Sales (Rp)").numFmt).toContain("Rp");
    expect(cellByHeader(ws, "Peserta Aktual").value).toBe(620);
    expect(cellByHeader(ws, "Rencana Budget Event (Rp)").value).toBe(5_000_000);
    expect(cellByHeader(ws, "Realisasi Budget Event (Rp)").value).toBe(4_750_000);
    expect(cellByHeader(ws, "Rencana Budget Sample (Rp)").value).toBe(1_000_000);
    expect(cellByHeader(ws, "Nilai Sampling (Rp)").value).toBe(900_000);
    expect(cellByHeader(ws, "Vendor").value).toBe("EO Kreatif");
    expect(cellByHeader(ws, "Keterangan").value).toBe("Kerja sama kelurahan");
  });

  it("labels needs-update events and leaves unfilled realization blank", () => {
    const ws = buildEventWorkbook(
      data({
        events: [
          event({
            status: "rencana",
            actual_participants: null,
            actual_sales: null,
            needs_update: true,
            lacks_photo: false,
            costs: { ...event().costs!, actual_budget: null },
          }),
        ],
      })
    ).getWorksheet("Event")!;
    expect(cellByHeader(ws, "Status").value).toBe("Rencana");
    expect(cellByHeader(ws, "Badge").value).toBe("Perlu update");
    expect(cellByHeader(ws, "Peserta Aktual").value).toBeNull();
    expect(cellByHeader(ws, "Realisasi Budget Event (Rp)").value).toBeNull();
  });

  it("writes one sampling row per product referencing its event, with rupiah value", () => {
    const ws = wb.getWorksheet("Rincian Sampling")!;
    expect(ws.getCell("A1").value).toBe("Monitoring Event FY 2026 Q2 • Filter: Semua event");
    expect(cellByHeader(ws, "No Event").value).toBe(1);
    expect(cellByHeader(ws, "Nama Event").value).toBe("Senam Pagi Wangzai");
    expect(cellByHeader(ws, "Produk").value).toBe("Wangzai Susu 125ml");
    expect(cellByHeader(ws, "Qty").value).toBe(300);
    expect(cellByHeader(ws, "Satuan").value).toBe("pcs");
    expect(cellByHeader(ws, "Nilai (Rp)").value).toBe(900_000);
  });

  it("shows an empty-state message when there is no event", () => {
    const ws = buildEventWorkbook(data({ events: [], samplings: [] })).getWorksheet("Event")!;
    expect(ws.getCell("A4").value).toBe("Tidak ada event untuk periode dan filter ini.");
  });
});

const COST_HEADERS = [
  "Rencana Budget Event (Rp)",
  "Realisasi Budget Event (Rp)",
  "Rencana Budget Sample (Rp)",
  "Nilai Sampling (Rp)",
  "Vendor",
];

describe("buildEventWorkbook — distributor", () => {
  const d = data({
    showCosts: false,
    events: [event({ costs: undefined })],
    samplings: [{ ...data().samplings[0], value: undefined }],
  });
  const wb = buildEventWorkbook(d);

  it("omits cost and vendor columns from the event sheet", () => {
    const ws = wb.getWorksheet("Event")!;
    const cols = headers(ws, 3);
    for (const h of COST_HEADERS) expect(cols).not.toContain(h);
    expect(cellByHeader(ws, "Target Sales (Rp)").value).toBe(10_000_000);
    expect(cellByHeader(ws, "Hasil Sales (Rp)").value).toBe(12_500_000);
  });

  it("keeps sampling quantity but omits its rupiah value", () => {
    const ws = wb.getWorksheet("Rincian Sampling")!;
    expect(headers(ws, 3)).not.toContain("Nilai (Rp)");
    expect(cellByHeader(ws, "Qty").value).toBe(300);
  });

  it("writes no cost number even if one slips into the data", () => {
    const leaky = buildEventWorkbook({ ...d, events: [event()], samplings: data().samplings });
    const values: unknown[] = [];
    for (const ws of leaky.worksheets) ws.eachRow((row) => row.eachCell((c) => values.push(c.value)));
    for (const secret of [5_000_000, 4_750_000, 1_000_000, 900_000, "EO Kreatif"]) {
      expect(values).not.toContain(secret);
    }
  });
});

describe("eventExportFilename", () => {
  it("includes the fiscal year and quarter", () => {
    expect(eventExportFilename(2026, 2)).toBe("monitoring-event-fy2026-q2.xlsx");
  });
});

import { describe, it, expect } from "vitest";
import {
  canViewEvent,
  eventDetailSelect,
  eventExportHref,
  eventExportSelect,
  eventFilterLabel,
  eventListSelect,
  publicEventKpis,
  eventFiscalPeriod,
  eventLacksPhoto,
  eventPhotoLimitError,
  eventPhotoPath,
  EVENT_PHOTO_MAX,
  eventNeedsUpdate,
  formatEventAuditValue,
  parseEventAuditFilters,
  parseEventListFilters,
  parseEventSampling,
  parseEventPlan,
  parseEventStatusUpdate,
  summarizeEventKpis,
  summarizeEventSampling,
  suggestFromCampaign,
  todayInJakarta,
} from "./event";

describe("eventFiscalPeriod", () => {
  it("places an event spanning 28 Sep – 3 Oct in Q2 by its start date", () => {
    expect(eventFiscalPeriod("2026-09-28")).toEqual({ fiscalYear: 2026, quarter: 2 });
  });

  it.each([
    ["2026-04-01", 2026, 1],
    ["2026-06-30", 2026, 1],
    ["2026-10-01", 2026, 3],
    ["2026-12-31", 2026, 3],
    ["2027-01-01", 2026, 4],
    ["2027-03-31", 2026, 4],
  ])("maps %s to FY %i Q%i", (date, fiscalYear, quarter) => {
    expect(eventFiscalPeriod(date)).toEqual({ fiscalYear, quarter });
  });
});

const REGION_ID = "11111111-1111-4111-8111-111111111111";

const validPlan = {
  name: "  Senam Sehat Agustusan ",
  event_type: "Senam/Olahraga",
  start_date: "2026-09-28",
  end_date: "2026-10-03",
  region_id: REGION_ID,
  location: "Lapangan Merdeka",
  pic_name: "Budi",
  target_participants: "500",
  target_sales: "25000000",
  planned_budget: "15000000",
  planned_sample_budget: "3000000",
};

describe("parseEventPlan", () => {
  it("parses a complete Rencana form into event and cost columns", () => {
    expect(parseEventPlan(validPlan)).toEqual({
      data: {
        event: {
          name: "Senam Sehat Agustusan",
          event_type: "Senam/Olahraga",
          start_date: "2026-09-28",
          end_date: "2026-10-03",
          region_id: REGION_ID,
          location: "Lapangan Merdeka",
          pic_name: "Budi",
          target_participants: 500,
          target_sales: 25000000,
          distributor_id: null,
          notes: null,
        },
        costs: { planned_budget: 15000000, planned_sample_budget: 3000000, vendor_id: null },
        links: { brand_ids: [], campaign_ids: [] },
      },
    });
  });

  it("parses the optional brands, distributor, vendor, SKPs, and notes", () => {
    const brandA = "22222222-2222-4222-8222-222222222222";
    const brandB = "33333333-3333-4333-8333-333333333333";
    const distributor = "44444444-4444-4444-8444-444444444444";
    const vendor = "55555555-5555-4555-8555-555555555555";
    const skp = "66666666-6666-4666-8666-666666666666";
    const result = parseEventPlan({
      ...validPlan,
      distributor_id: distributor,
      vendor_id: vendor,
      notes: "  Didanai dua SKP ",
      brand_ids: [brandA, brandB, brandA],
      campaign_ids: [skp],
    });
    expect(result).toHaveProperty("data.event.distributor_id", distributor);
    expect(result).toHaveProperty("data.event.notes", "Didanai dua SKP");
    expect(result).toHaveProperty("data.costs.vendor_id", vendor);
    expect(result).toHaveProperty("data.links", { brand_ids: [brandA, brandB], campaign_ids: [skp] });
  });

  it("treats blank optional fields as empty", () => {
    const result = parseEventPlan({ ...validPlan, distributor_id: "", vendor_id: "", notes: "   " });
    expect(result).toHaveProperty("data.event.distributor_id", null);
    expect(result).toHaveProperty("data.event.notes", null);
    expect(result).toHaveProperty("data.costs.vendor_id", null);
  });

  it.each([
    ["distributor_id", "x", "Distributor tidak valid"],
    ["vendor_id", "x", "Vendor tidak valid"],
    ["brand_ids", ["x"], "Brand tidak valid"],
    ["campaign_ids", ["x"], "SKP tidak valid"],
  ])("rejects an invalid %s", (field, value, message) => {
    expect(parseEventPlan({ ...validPlan, [field]: value })).toEqual({ error: message });
  });

  it("rejects an end date before the start date", () => {
    expect(parseEventPlan({ ...validPlan, end_date: "2026-09-27" })).toEqual({
      error: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    });
  });

  it("accepts a one-day event", () => {
    expect(parseEventPlan({ ...validPlan, end_date: "2026-09-28" })).toHaveProperty("data");
  });

  it.each([
    ["name", "   ", "Nama event harus diisi"],
    ["event_type", undefined, "Pilih jenis event"],
    ["event_type", "Konser", "Pilih jenis event"],
    ["start_date", "", "Tanggal mulai harus diisi"],
    ["region_id", undefined, "Pilih region"],
    ["location", "", "Lokasi harus diisi"],
    ["pic_name", " ", "PIC harus diisi"],
    ["target_participants", "", "Target peserta harus diisi"],
    ["target_participants", "12.5", "Target peserta harus bilangan bulat"],
    ["target_sales", "-1", "Target sales tidak boleh negatif"],
    ["planned_budget", undefined, "Rencana budget event harus diisi"],
    ["planned_sample_budget", "abc", "Rencana budget sample harus berupa angka"],
  ])("rejects %s = %j", (field, value, message) => {
    expect(parseEventPlan({ ...validPlan, [field]: value })).toEqual({ error: message });
  });

  it("allows zero targets and budgets", () => {
    const result = parseEventPlan({
      ...validPlan,
      target_participants: "0",
      target_sales: "0",
      planned_budget: "0",
      planned_sample_budget: "0",
    });
    expect(result).toHaveProperty("data.costs", { planned_budget: 0, planned_sample_budget: 0, vendor_id: null });
  });
});

describe("parseEventAuditFilters", () => {
  const uuid = "88888888-8888-4888-8888-888888888888";

  it("accepts the event tables and a record id", () => {
    expect(parseEventAuditFilters({ table: "event_costs", record: uuid, action: "soft_delete" })).toEqual({
      table: "event_costs",
      record: uuid,
      action: "soft_delete",
      page: 1,
    });
  });

  it("accepts the sampling tables", () => {
    expect(parseEventAuditFilters({ table: "event_samplings" })).toEqual({ table: "event_samplings", page: 1 });
    expect(parseEventAuditFilters({ table: "event_sampling_costs" })).toEqual({ table: "event_sampling_costs", page: 1 });
  });

  it("ignores tables outside the event module", () => {
    expect(parseEventAuditFilters({ table: "posm_items" })).toEqual({ page: 1 });
  });
});

describe("formatEventAuditValue", () => {
  const names = new Map([["r1", "Jawa Timur"]]);

  it.each([
    ["target_sales", 50000000],
    ["planned_budget", "20000000"],
    ["actual_budget", 1500000],
    ["planned_sample_budget", 5000000],
    ["actual_sales", 0],
    ["value", 360000],
  ])("formats %s as rupiah", (field, value) => {
    expect(formatEventAuditValue(field, value, names)).toMatch(/^Rp/);
  });

  it("shows the status label and region name", () => {
    expect(formatEventAuditValue("status", "terlaksana", names)).toBe("Terlaksana");
    expect(formatEventAuditValue("region_id", "r1", names)).toBe("Jawa Timur");
  });

  it("formats participant counts as plain numbers", () => {
    expect(formatEventAuditValue("target_participants", 1000, names)).toBe("1.000");
  });
});

describe("suggestFromCampaign", () => {
  const skp = { region_id: "r1", distributor_id: "d1", brand_id: "b1" };
  const empty = { region_id: "", distributor_id: "", brand_ids: [] as string[] };

  it("fills empty region, distributor, and brand without asking", () => {
    expect(suggestFromCampaign(empty, skp)).toEqual({
      fill: { region_id: "r1", distributor_id: "d1", brand_ids: ["b1"] },
      confirm: {},
    });
  });

  it("asks before replacing filled fields or adding a brand", () => {
    expect(suggestFromCampaign({ region_id: "r2", distributor_id: "d2", brand_ids: ["b2"] }, skp)).toEqual({
      fill: {},
      confirm: { region_id: "r1", distributor_id: "d1", brand_ids: ["b2", "b1"] },
    });
  });

  it("skips fields that already match or that the SKP leaves empty", () => {
    expect(
      suggestFromCampaign(
        { region_id: "r1", distributor_id: "d2", brand_ids: ["b2", "b1"] },
        { region_id: "r1", distributor_id: null, brand_id: "b1" }
      )
    ).toEqual({ fill: {}, confirm: {} });
  });
});

describe("export helpers", () => {
  const REGION = "33333333-3333-3333-3333-333333333333";

  it("eventExportSelect requests costs and sampling value only for internal viewers", () => {
    expect(eventExportSelect({ showCosts: true })).toContain("event_costs");
    expect(eventExportSelect({ showCosts: true })).toContain("event_sampling_costs");
    const distributor = eventExportSelect({ showCosts: false });
    expect(distributor).not.toMatch(/event_costs|event_sampling_costs|vendor/);
    expect(distributor).toContain("quantity");
  });

  it("eventFilterLabel summarizes active filters or says none", () => {
    expect(eventFilterLabel({}, { region: new Map(), brand: new Map() })).toBe("Semua event");
    expect(
      eventFilterLabel(
        { type: "Bazaar", region: REGION, status: "batal" },
        { region: new Map([[REGION, "Jawa Barat"]]), brand: new Map() }
      )
    ).toBe("Jenis: Bazaar • Region: Jawa Barat • Status: Batal");
  });

  it("eventExportHref carries period and filters", () => {
    expect(eventExportHref(2026, 2, {})).toBe("/api/export/monitoring-event?fy=2026&q=2");
    expect(eventExportHref(2026, 3, { region: REGION, status: "rencana" })).toBe(
      `/api/export/monitoring-event?fy=2026&q=3&region=${REGION}&status=rencana`
    );
  });
});

describe("parseEventListFilters", () => {
  const region = "11111111-1111-4111-8111-111111111111";
  const brand = "22222222-2222-4222-8222-222222222222";

  it("keeps valid type, region, brand, and status together", () => {
    expect(
      parseEventListFilters({ fy: "2026", q: "2", type: "Bazaar", region, brand, status: "terlaksana" })
    ).toEqual({ type: "Bazaar", region, brand, status: "terlaksana" });
  });

  it("drops unknown or malformed values", () => {
    expect(
      parseEventListFilters({ type: "Konser", region: "jatim", brand: ["x", brand], status: "selesai" })
    ).toEqual({});
  });

  it("returns no filters for an empty query string", () => {
    expect(parseEventListFilters({})).toEqual({});
  });
});

describe("event link audit", () => {
  it.each(["event_brands", "event_campaigns"])("accepts %s as an audit table", (table) => {
    expect(parseEventAuditFilters({ table })).toEqual({ table, page: 1 });
  });

  it("shows the linked brand name", () => {
    expect(formatEventAuditValue("brand_id", "b1", new Map([["b1", "Want Want"]]))).toBe("Want Want");
  });
});

describe("parseEventStatusUpdate", () => {
  const today = "2026-09-28";

  it("accepts Terlaksana with all realization fields for an event that has started", () => {
    expect(
      parseEventStatusUpdate(
        { status: "terlaksana", actual_participants: "850", actual_sales: "42000000", actual_budget: "19500000" },
        { startDate: "2026-09-28", today }
      )
    ).toEqual({
      data: {
        status: "terlaksana",
        actual_participants: 850,
        actual_sales: 42000000,
        actual_budget: 19500000,
        cancel_reason: null,
      },
    });
  });

  it.each([
    [{ actual_sales: "1", actual_budget: "1" }, "Peserta aktual harus diisi"],
    [{ actual_participants: "1", actual_budget: "1" }, "Hasil sales harus diisi"],
    [{ actual_participants: "1", actual_sales: "1", actual_budget: "" }, "Realisasi budget event harus diisi"],
    [{ actual_participants: "1.5", actual_sales: "1", actual_budget: "1" }, "Peserta aktual harus bilangan bulat"],
    [{ actual_participants: "1", actual_sales: "-1", actual_budget: "1" }, "Hasil sales tidak boleh negatif"],
  ])("rejects Terlaksana with missing or invalid realization %o", (fields, error) => {
    expect(parseEventStatusUpdate({ status: "terlaksana", ...fields }, { startDate: "2026-09-01", today })).toEqual({
      error,
    });
  });

  it("rejects Terlaksana for an event that has not started yet", () => {
    expect(
      parseEventStatusUpdate(
        { status: "terlaksana", actual_participants: "1", actual_sales: "1", actual_budget: "1" },
        { startDate: "2026-09-29", today }
      )
    ).toEqual({ error: "Event belum dimulai, belum bisa ditandai Terlaksana" });
  });

  it("rejects Batal without a reason", () => {
    expect(parseEventStatusUpdate({ status: "batal", cancel_reason: "  " }, { startDate: "2026-10-10", today })).toEqual({
      error: "Alasan batal harus diisi",
    });
  });

  it("accepts Batal with a forfeited budget, even before the event starts", () => {
    expect(
      parseEventStatusUpdate(
        { status: "batal", cancel_reason: "Venue batal", actual_budget: "2500000", actual_sales: "99" },
        { startDate: "2026-10-10", today }
      )
    ).toEqual({
      data: {
        status: "batal",
        actual_participants: null,
        actual_sales: null,
        actual_budget: 2500000,
        cancel_reason: "Venue batal",
      },
    });
  });

  it("accepts Batal without a realized budget", () => {
    expect(
      parseEventStatusUpdate({ status: "batal", cancel_reason: "Hujan", actual_budget: "" }, { startDate: "2026-10-10", today })
    ).toMatchObject({ data: { status: "batal", actual_budget: null } });
  });

  it("accepts a correction back to Rencana without touching realization", () => {
    expect(parseEventStatusUpdate({ status: "rencana", actual_budget: "5" }, { startDate: "2026-09-01", today })).toEqual({
      data: { status: "rencana", actual_participants: null, actual_sales: null, actual_budget: null, cancel_reason: null },
    });
  });

  it("rejects an unknown status", () => {
    expect(parseEventStatusUpdate({ status: "selesai" }, { startDate: "2026-09-01", today })).toEqual({
      error: "Pilih status",
    });
  });
});

describe("eventNeedsUpdate", () => {
  const today = "2026-09-28";

  it.each([
    ["rencana", "2026-09-27", true],
    ["rencana", "2026-09-28", false],
    ["rencana", "2026-10-01", false],
    ["terlaksana", "2026-09-01", false],
    ["batal", "2026-09-01", false],
  ] as const)("status %s ending %s → %s", (status, end_date, expected) => {
    expect(eventNeedsUpdate({ status, end_date }, today)).toBe(expected);
  });
});

describe("todayInJakarta", () => {
  it("uses the Jakarta date, not UTC", () => {
    // 28 Sep 18:30 UTC = 29 Sep 01:30 WIB.
    expect(todayInJakarta(new Date("2026-09-28T18:30:00Z"))).toBe("2026-09-29");
  });
});

describe("parseEventSampling", () => {
  it("parses a sampling row with its Rupiah value", () => {
    expect(
      parseEventSampling({ product_name: " Want Want Rice Cracker ", quantity: "2.5", unit: " karton ", value: "750000" })
    ).toEqual({ data: { product_name: "Want Want Rice Cracker", quantity: 2.5, unit: "karton", value: 750000 } });
  });

  const row = { product_name: "Rice Cracker", quantity: "10", unit: "pcs", value: "0" };

  it("accepts a zero Rupiah value", () => {
    expect(parseEventSampling(row)).toEqual({ data: { product_name: "Rice Cracker", quantity: 10, unit: "pcs", value: 0 } });
  });

  it.each([
    [{ quantity: "0" }, "Qty harus lebih dari 0"],
    [{ quantity: "-1" }, "Qty harus lebih dari 0"],
    [{ quantity: "" }, "Qty harus diisi"],
    [{ quantity: "abc" }, "Qty harus berupa angka"],
    [{ value: "-1" }, "Nilai sampling tidak boleh negatif"],
    [{ value: "" }, "Nilai sampling harus diisi"],
    [{ product_name: "  " }, "Nama produk harus diisi"],
    [{ unit: "" }, "Satuan harus diisi"],
  ])("rejects %o", (override, error) => {
    expect(parseEventSampling({ ...row, ...override })).toEqual({ error });
  });
});

describe("summarizeEventSampling", () => {
  it("totals sampling values and compares them with the planned sample budget", () => {
    expect(summarizeEventSampling([{ value: 1_500_000 }, { value: 2_000_000 }], 5_000_000)).toEqual({
      total: 3_500_000,
      planned: 5_000_000,
      remaining: 1_500_000,
      percentOfPlan: 70,
    });
  });

  it("reports a negative remainder when sampling exceeds the plan", () => {
    expect(summarizeEventSampling([{ value: 6_000_000 }], 5_000_000)).toMatchObject({
      remaining: -1_000_000,
      percentOfPlan: 120,
    });
  });

  it("has no percentage when the planned sample budget is zero", () => {
    expect(summarizeEventSampling([{ value: 250_000 }], 0)).toEqual({
      total: 250_000,
      planned: 0,
      remaining: -250_000,
      percentOfPlan: null,
    });
  });

  it("allows an event without sampling rows", () => {
    expect(summarizeEventSampling([], 5_000_000)).toEqual({
      total: 0,
      planned: 5_000_000,
      remaining: 5_000_000,
      percentOfPlan: 0,
    });
  });
});

type KpiEvent = Parameters<typeof summarizeEventKpis>[0][number];

const kpiEvent = (overrides: Partial<KpiEvent>): KpiEvent => ({
  status: "rencana",
  target_participants: 0,
  target_sales: 0,
  actual_participants: null,
  actual_sales: null,
  planned_budget: 0,
  actual_budget: null,
  planned_sample_budget: 0,
  sampling_value: 0,
  ...overrides,
});

describe("summarizeEventKpis", () => {
  it("counts events per status", () => {
    const kpis = summarizeEventKpis([
      kpiEvent({ status: "rencana" }),
      kpiEvent({ status: "terlaksana" }),
      kpiEvent({ status: "terlaksana" }),
      kpiEvent({ status: "batal" }),
    ]);
    expect(kpis.counts).toEqual({ rencana: 1, terlaksana: 2, batal: 1, total: 4 });
  });
});

describe("summarizeEventKpis — target vs aktual", () => {
  it("targets Rencana + Terlaksana, actuals only from Terlaksana, Batal excluded", () => {
    const kpis = summarizeEventKpis([
      kpiEvent({ status: "rencana", target_participants: 100, target_sales: 1_000_000 }),
      kpiEvent({
        status: "terlaksana",
        target_participants: 200,
        target_sales: 2_000_000,
        actual_participants: 250,
        actual_sales: 1_800_000,
      }),
      kpiEvent({ status: "batal", target_participants: 999, target_sales: 9_999_999 }),
      // Koreksi Terlaksana → Rencana: realisasi lama tersimpan tapi bukan aktual.
      kpiEvent({ status: "rencana", target_participants: 50, actual_participants: 40, actual_sales: 500_000 }),
    ]);
    expect(kpis.participants).toEqual({ target: 350, actual: 250 });
    expect(kpis.sales).toEqual({ target: 3_000_000, actual: 1_800_000 });
  });
});

describe("summarizeEventKpis — budget", () => {
  const kpis = summarizeEventKpis([
    kpiEvent({ status: "rencana", planned_budget: 10_000_000, planned_sample_budget: 1_000_000, sampling_value: 300_000 }),
    kpiEvent({
      status: "terlaksana",
      planned_budget: 20_000_000,
      actual_budget: 18_000_000,
      planned_sample_budget: 2_000_000,
      sampling_value: 2_500_000,
    }),
    // Biaya hangus event Batal tetap terpakai, rencananya tidak dihitung.
    kpiEvent({
      status: "batal",
      planned_budget: 50_000_000,
      actual_budget: 5_000_000,
      planned_sample_budget: 4_000_000,
      sampling_value: 100_000,
    }),
    kpiEvent({ status: "batal", planned_budget: 7_000_000, actual_budget: null }),
    kpiEvent({ status: "rencana", planned_budget: 1_000_000, actual_budget: 900_000 }),
  ]);

  it("plans from Rencana + Terlaksana and spends Terlaksana + Batal realisation", () => {
    expect(kpis.budget).toEqual({ target: 31_000_000, actual: 23_000_000 });
  });

  it("compares planned sample budget with sampling value used by Terlaksana + Batal", () => {
    expect(kpis.sampleBudget).toEqual({ target: 3_000_000, actual: 2_600_000 });
  });
});

it("summarizeEventKpis returns zeros for no events", () => {
  expect(summarizeEventKpis([])).toEqual({
    counts: { rencana: 0, terlaksana: 0, batal: 0, total: 0 },
    participants: { target: 0, actual: 0 },
    sales: { target: 0, actual: 0 },
    budget: { target: 0, actual: 0 },
    sampleBudget: { target: 0, actual: 0 },
  });
});

describe("canViewEvent — akses distributor (mirror RLS migrasi 059)", () => {
  const event = { region_id: "region-a", distributor_id: "dist-x" };
  const distributor = (region_id: string | null, distributor_id: string | null) => ({
    role: "distributor" as const,
    region_id,
    distributor_id,
  });

  it("lets internal roles see every event regardless of region", () => {
    for (const role of ["user", "manager", "finance", "admin", "superadmin"] as const) {
      expect(canViewEvent(event, { role, region_id: "region-b", distributor_id: null })).toBe(true);
    }
  });

  it("lets a distributor see an event in its region", () => {
    expect(canViewEvent(event, distributor("region-a", "dist-y"))).toBe(true);
  });

  it("lets a distributor see an event that links its distributor in another region", () => {
    expect(canViewEvent(event, distributor("region-b", "dist-x"))).toBe(true);
  });

  it("lets a distributor without a region see only events linking its distributor", () => {
    expect(canViewEvent(event, distributor(null, "dist-x"))).toBe(true);
    expect(canViewEvent(event, distributor(null, "dist-y"))).toBe(false);
  });

  it("hides an event when neither region nor distributor matches", () => {
    expect(canViewEvent(event, distributor("region-b", "dist-y"))).toBe(false);
  });

  it("never matches on a missing distributor on either side", () => {
    expect(canViewEvent({ region_id: "region-a", distributor_id: null }, distributor("region-b", null))).toBe(false);
  });
});

describe("eventListSelect / eventDetailSelect — kolom per viewer", () => {
  const COST_SOURCES = ["event_costs", "event_sampling_costs", "vendor", "budget", "value"];

  it.each([
    ["list", eventListSelect],
    ["detail", eventDetailSelect],
  ])("never requests cost, sampling value, or vendor data for distributors (%s)", (_, select) => {
    const columns = select({ showCosts: false });
    for (const source of COST_SOURCES) expect(columns).not.toContain(source);
  });

  it.each([
    ["list", eventListSelect],
    ["detail", eventDetailSelect],
  ])("requests costs and sampling values for internal viewers (%s)", (_, select) => {
    const columns = select({ showCosts: true });
    expect(columns).toContain("event_costs");
    expect(columns).toContain("event_sampling_costs");
  });

  it("keeps sampling qty for distributors on the detail page", () => {
    expect(eventDetailSelect({ showCosts: false })).toContain("samplings:event_samplings(id, product_name, quantity, unit");
  });

  it.each([true, false])("requests photo rows for the \"Belum ada foto\" indicator (showCosts %s)", (showCosts) => {
    expect(eventListSelect({ showCosts })).toContain("photos:event_photos(deleted_at)");
  });

  it("requests the vendor only on the internal detail page", () => {
    expect(eventDetailSelect({ showCosts: true })).toContain("vendor:vendors(name)");
  });
});

describe("publicEventKpis", () => {
  it("keeps only counts, participants, and sales for distributors", () => {
    const kpis = summarizeEventKpis([
      {
        status: "terlaksana",
        target_participants: 100,
        target_sales: 1_000_000,
        actual_participants: 120,
        actual_sales: 900_000,
        planned_budget: 5_000_000,
        actual_budget: 4_000_000,
        planned_sample_budget: 1_000_000,
        sampling_value: 500_000,
      },
    ]);
    const visible = publicEventKpis(kpis);
    expect(Object.keys(visible).sort()).toEqual(["counts", "participants", "sales"]);
    expect(visible.participants).toEqual({ target: 100, actual: 120 });
  });
});

describe("eventLacksPhoto", () => {
  it.each([
    ["terlaksana", 0, true],
    ["terlaksana", 1, false],
    ["rencana", 0, false],
    ["batal", 0, false],
  ] as const)("status %s with %i photos → %s", (status, photoCount, expected) => {
    expect(eventLacksPhoto({ status }, photoCount)).toBe(expected);
  });
});

describe("eventPhotoLimitError", () => {
  it("allows uploads while under the limit", () => {
    expect(EVENT_PHOTO_MAX).toBe(10);
    expect(eventPhotoLimitError(0, 1)).toBeNull();
    expect(eventPhotoLimitError(9, 1)).toBeNull();
    expect(eventPhotoLimitError(7, 3)).toBeNull();
  });

  it("rejects the 11th photo with a clear message", () => {
    expect(eventPhotoLimitError(10, 1)).toBe("Maksimal 10 foto per event. Hapus foto lain terlebih dahulu.");
  });

  it("rejects a batch that would exceed the limit and says how many slots remain", () => {
    expect(eventPhotoLimitError(8, 3)).toBe("Maksimal 10 foto per event. Sisa slot: 2 foto.");
  });
});

describe("eventPhotoPath", () => {
  it("puts the event id as the first folder, which the storage policy checks", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(eventPhotoPath(id, 1700000000000)).toBe(`${id}/1700000000000.jpg`);
  });
});

describe("event photo audit", () => {
  it("accepts event_photos as an audit table", () => {
    expect(parseEventAuditFilters({ table: "event_photos" })).toEqual({ table: "event_photos", page: 1 });
  });
});

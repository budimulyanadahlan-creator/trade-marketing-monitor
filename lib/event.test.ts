import { describe, it, expect } from "vitest";
import {
  eventFiscalPeriod,
  formatEventAuditValue,
  parseEventAuditFilters,
  parseEventListFilters,
  parseEventPlan,
  suggestFromCampaign,
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

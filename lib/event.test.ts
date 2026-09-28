import { describe, it, expect } from "vitest";
import { eventFiscalPeriod, parseEventPlan } from "./event";

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
        },
        costs: { planned_budget: 15000000, planned_sample_budget: 3000000 },
      },
    });
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
    expect(result).toHaveProperty("data.costs", { planned_budget: 0, planned_sample_budget: 0 });
  });
});

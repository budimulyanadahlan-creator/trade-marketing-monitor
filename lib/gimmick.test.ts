import { describe, it, expect } from "vitest";
import type { GimmickDestination, PosmMovementType } from "@/types/database";
import { nextCode } from "./posm";
import {
  cartonsToPcs,
  formatPcsWithCartons,
  summarizeGimmickStock,
  withRunningValue,
  distinctPrograms,
  gimmickDestination,
  gimmickMovementFiltersQuery,
  outValueInMonth,
  parseGimmickMovementFilters,
  GIMMICK_CATEGORIES,
  GIMMICK_CODE_PREFIX,
  GIMMICK_UNITS,
  monitoringPosmTabs,
  resolveMonitoringPosmTab,
  aggregateGimmickRegionRekap,
  aggregateGimmickDestinationRekap,
  aggregateGimmickProgramRekap,
  gimmickRekapFiltersQuery,
  parseGimmickRekapFilters,
  type GimmickRekapMovement,
} from "./gimmick";

describe("resolveMonitoringPosmTab", () => {
  it("opens the gimmick tab for a writer", () => {
    expect(resolveMonitoringPosmTab("gimmick", true)).toBe("gimmick");
  });

  it("sends a non-writer who opens the gimmick tab to the POSM tab", () => {
    expect(resolveMonitoringPosmTab("gimmick", false)).toBe("posm");
  });

  it("keeps the asset tab for everyone and defaults to POSM", () => {
    expect(resolveMonitoringPosmTab("asset", false)).toBe("asset");
    expect(resolveMonitoringPosmTab(undefined, true)).toBe("posm");
    expect(resolveMonitoringPosmTab("lain", true)).toBe("posm");
  });
});

describe("monitoringPosmTabs", () => {
  it("lists the gimmick tab only for a writer", () => {
    expect(monitoringPosmTabs(true).map((t) => t.value)).toEqual(["posm", "asset", "gimmick"]);
    expect(monitoringPosmTabs(false).map((t) => t.value)).toEqual(["posm", "asset"]);
  });
});

describe("distinctPrograms", () => {
  it("lists each program once, case-insensitively, sorted, skipping empty values", () => {
    const items = [
      { program: "Imlek 2027" },
      { program: "Lebaran 2027" },
      { program: "imlek 2027 " },
      { program: null },
      { program: "  " },
    ];
    expect(distinctPrograms(items)).toEqual(["Imlek 2027", "Lebaran 2027"]);
  });
});

describe("gimmick constants", () => {
  it("match the fixed lists in the gimmick_items check constraints", () => {
    expect(GIMMICK_CATEGORIES).toEqual(["Payung", "Tas", "Botol/Gelas", "Mainan", "Pakaian", "Alat Tulis", "Lainnya"]);
    expect(GIMMICK_UNITS).toEqual(["pcs", "set"]);
  });

  it("suggests the next GMK code", () => {
    expect(nextCode(GIMMICK_CODE_PREFIX, ["GMK-0001", "gmk-0007", "PAYUNG-A"])).toBe("GMK-0008");
    expect(nextCode(GIMMICK_CODE_PREFIX, [])).toBe("GMK-0001");
  });
});

describe("cartonsToPcs", () => {
  it("converts 3 cartons + 5 pcs of a 24-per-carton item to 77 pcs", () => {
    expect(cartonsToPcs({ cartons: 3, pcs: 5 }, 24)).toBe(77);
  });
});

describe("formatPcsWithCartons", () => {
  it("shows the carton breakdown next to the pcs total", () => {
    expect(formatPcsWithCartons(77, 24, "pcs")).toBe("77 pcs (3 krt + 5 pcs)");
  });

  it("omits the remainder for whole cartons and the breakdown below one carton", () => {
    expect(formatPcsWithCartons(72, 24, "pcs")).toBe("72 pcs (3 krt)");
    expect(formatPcsWithCartons(5, 24, "pcs")).toBe("5 pcs");
  });

  it("shows only the total for items without a carton size, using thousand separators", () => {
    expect(formatPcsWithCartons(1200, null, "set")).toBe("1.200 set");
  });

  it("breaks down the magnitude of negative quantities", () => {
    expect(formatPcsWithCartons(-77, 24, "pcs")).toBe("-77 pcs (3 krt + 5 pcs)");
  });
});

describe("summarizeGimmickStock", () => {
  const row = (is_active: boolean, balance: number, min_stock: number | null, unit_cost: number) => ({
    is_active,
    balance,
    min_stock,
    unit_cost,
  });

  it("counts active items by stock status and values all stock at the current master cost", () => {
    const summary = summarizeGimmickStock([
      row(true, 77, 24, 45000), // aman
      row(true, 10, 24, 12500), // menipis
      row(true, 0, null, 8000), // habis
      row(false, 4, null, 1000), // nonaktif: tidak dihitung status, nilainya tetap
    ]);

    expect(summary).toEqual({
      activeItems: 3,
      lowStock: 1,
      outOfStock: 1,
      totalValue: 77 * 45000 + 10 * 12500 + 4 * 1000,
    });
  });
});

describe("withRunningValue", () => {
  it("adds the running balance and the snapshot value of each transaction", () => {
    const rows = withRunningValue([
      { movement_date: "2026-09-02", created_at: "b", quantity: -5, unit_cost_snapshot: 50000 },
      { movement_date: "2026-09-01", created_at: "a", quantity: 77, unit_cost_snapshot: 45000 },
    ]);

    expect(rows.map((r) => [r.quantity, r.running_balance, r.value])).toEqual([
      [77, 77, 77 * 45000],
      [-5, 72, -5 * 50000],
    ]);
  });
});

describe("gimmickDestination", () => {
  const out = { type: "out" as const, region_id: "r1", distributor_id: "d1", campaign_id: "c1", recipient_name: "Budi" };

  it("requires a destination for Keluar and a region for Region/Distributor", () => {
    expect(gimmickDestination(out)).toEqual({ error: "Pilih tujuan keluar" });
    expect(gimmickDestination({ ...out, destination: "region_distributor", region_id: undefined })).toEqual({
      error: "Region tujuan harus diisi",
    });
  });

  it("requires a description for Event, Internal and Lainnya", () => {
    expect(gimmickDestination({ ...out, destination: "event", notes: " " })).toEqual({ error: "Nama event harus diisi" });
    expect(gimmickDestination({ ...out, destination: "internal" })).toEqual({
      error: "Keterangan keperluan internal harus diisi",
    });
    expect(gimmickDestination({ ...out, destination: "other" })).toEqual({ error: "Keterangan harus diisi" });
  });

  it("keeps only the fields that belong to the destination; SKP and PIC for every destination", () => {
    expect(gimmickDestination({ ...out, destination: "region_distributor" })).toEqual({
      fields: { destination: "region_distributor", region_id: "r1", distributor_id: "d1", campaign_id: "c1", recipient_name: "Budi" },
    });
    expect(gimmickDestination({ ...out, destination: "event", notes: "Pameran JIExpo" })).toEqual({
      fields: { destination: "event", region_id: "r1", distributor_id: null, campaign_id: "c1", recipient_name: "Budi" },
    });
    expect(gimmickDestination({ ...out, destination: "internal", notes: "Hadiah karyawan" })).toEqual({
      fields: { destination: "internal", region_id: null, distributor_id: null, campaign_id: "c1", recipient_name: "Budi" },
    });
  });

  it("clears every destination field for non-Keluar types", () => {
    expect(gimmickDestination({ ...out, type: "in", destination: "event" })).toEqual({
      fields: { destination: null, region_id: null, distributor_id: null, campaign_id: null, recipient_name: null },
    });
  });
});

describe("gimmick movement filters", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";

  it("parses valid filters incl. destination and program, and drops invalid values", () => {
    expect(
      parseGimmickMovementFilters({
        from: "2026-09-01",
        to: "bukan-tanggal",
        type: "out",
        destination: "event",
        item: UUID_A,
        region: "x",
        program: "  Imlek 2027 ",
        page: "3",
      })
    ).toEqual({ from: "2026-09-01", type: "out", destination: "event", item: UUID_A, program: "Imlek 2027", page: 3 });
    expect(parseGimmickMovementFilters({ destination: "gudang", type: "hilang", page: "0" })).toEqual({ page: 1 });
  });

  it("round-trips through the query string, dropping page 1", () => {
    const filters = { from: "2026-09-01", destination: "internal" as const, program: "Imlek 2027", page: 1 };
    const qs = gimmickMovementFiltersQuery(filters);
    expect(qs).toBe("from=2026-09-01&destination=internal&program=Imlek+2027");
    expect(parseGimmickMovementFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual(filters);
    expect(gimmickMovementFiltersQuery({ ...filters, page: 2 })).toContain("page=2");
  });
});

describe("outValueInMonth", () => {
  it("sums |qty| × snapshot of Keluar in the month only", () => {
    const value = outValueInMonth(
      [
        { type: "out", movement_date: "2026-09-01", quantity: -10, unit_cost_snapshot: 45000 },
        { type: "out", movement_date: "2026-09-30", quantity: -2, unit_cost_snapshot: 12500 },
        { type: "out", movement_date: "2026-08-31", quantity: -100, unit_cost_snapshot: 1000 },
        { type: "in", movement_date: "2026-09-05", quantity: 50, unit_cost_snapshot: 45000 },
        { type: "adjustment", movement_date: "2026-09-05", quantity: -3, unit_cost_snapshot: 45000 },
      ],
      "2026-09"
    );
    expect(value).toBe(10 * 45000 + 2 * 12500);
  });
});

describe("gimmick out rekap", () => {
  const MONTHS = ["2026-08", "2026-09"];
  const base = {
    item_code: "GMK-0001",
    item_name: "Payung Wangzai",
    unit: "pcs",
    program: "Imlek 2027" as string | null,
    region_id: "r-jkt" as string | null,
    region_name: "Jakarta" as string | null,
    destination: "region_distributor" as GimmickDestination | null,
    type: "out" as PosmMovementType,
  };
  const movements: GimmickRekapMovement[] = [
    { ...base, item_id: "i1", movement_date: "2026-08-10", quantity: -10, unit_cost_snapshot: 45000 },
    { ...base, item_id: "i1", movement_date: "2026-09-02", quantity: -5, unit_cost_snapshot: 50000 },
    // Event dengan region: masuk rekap region, tujuan Event.
    { ...base, item_id: "i1", movement_date: "2026-09-03", quantity: -2, unit_cost_snapshot: 50000, destination: "event" },
    // Internal tanpa region: tidak masuk rekap region.
    {
      ...base,
      item_id: "i2",
      item_code: "GMK-0002",
      item_name: "Tas Kanvas",
      program: null,
      region_id: null,
      region_name: null,
      destination: "internal",
      movement_date: "2026-09-15",
      quantity: -3,
      unit_cost_snapshot: 12500,
    },
    // Tidak dihitung: penyesuaian, masuk, dan di luar rentang bulan.
    { ...base, item_id: "i1", movement_date: "2026-09-04", quantity: -1, unit_cost_snapshot: 50000, type: "adjustment", destination: null },
    { ...base, item_id: "i1", movement_date: "2026-09-04", quantity: 100, unit_cost_snapshot: 50000, type: "in", destination: null },
    { ...base, item_id: "i1", movement_date: "2026-07-31", quantity: -7, unit_cost_snapshot: 45000 },
  ];

  it("region rekap counts only Keluar with a region, in qty mode", () => {
    const rekap = aggregateGimmickRegionRekap(movements, MONTHS, "qty");
    expect(rekap.rows).toHaveLength(1);
    expect(rekap.rows[0]).toMatchObject({ item_id: "i1", region_id: "r-jkt", months: [10, 7], total: 17 });
    expect(rekap.monthTotals).toEqual([10, 7]);
    expect(rekap.grandTotal).toBe(17);
  });

  it("region rekap in value mode uses qty × snapshot", () => {
    const rekap = aggregateGimmickRegionRekap(movements, MONTHS, "value");
    expect(rekap.rows[0].months).toEqual([450000, 350000]);
    expect(rekap.grandTotal).toBe(800000);
  });

  it("destination rekap includes Keluar without region, ordered like the destination list", () => {
    const qty = aggregateGimmickDestinationRekap(movements, MONTHS, "qty");
    expect(qty.rows.map((r) => [r.destination, r.months, r.total])).toEqual([
      ["region_distributor", [10, 5], 15],
      ["event", [0, 2], 2],
      ["internal", [0, 3], 3],
    ]);
    expect(qty.grandTotal).toBe(20);

    const value = aggregateGimmickDestinationRekap(movements, MONTHS, "value");
    expect(value.monthTotals).toEqual([450000, 5 * 50000 + 2 * 50000 + 3 * 12500]);
  });

  it("program rekap groups items without a program as Tanpa Program, placed last", () => {
    const qty = aggregateGimmickProgramRekap(movements, MONTHS, "qty");
    expect(qty.rows.map((r) => [r.program, r.label, r.total])).toEqual([
      ["Imlek 2027", "Imlek 2027", 17],
      [null, "Tanpa Program", 3],
    ]);
    const value = aggregateGimmickProgramRekap(movements, MONTHS, "value");
    expect(value.rows.map((r) => r.total)).toEqual([800000, 37500]);
    expect(value.grandTotal).toBe(837500);
  });

  it("program rekap groups program names case-insensitively", () => {
    const rekap = aggregateGimmickProgramRekap(
      [movements[0], { ...movements[1], program: " imlek 2027" }],
      MONTHS,
      "qty"
    );
    expect(rekap.rows).toHaveLength(1);
    expect(rekap.rows[0].total).toBe(15);
  });
});

describe("gimmick rekap filters", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";

  it("defaults to the last 6 months in qty mode", () => {
    expect(parseGimmickRekapFilters({}, "2026-09-27")).toEqual({ from: "2026-04", to: "2026-09", mode: "qty" });
  });

  it("parses item, program and value mode, dropping invalid values and capping the range", () => {
    expect(
      parseGimmickRekapFilters(
        { from: "2023-01", to: "2026-09", item: UUID_A, program: " Imlek 2027 ", mode: "value", brand: UUID_A },
        "2026-09-27"
      )
    ).toEqual({ from: "2024-10", to: "2026-09", item: UUID_A, program: "Imlek 2027", mode: "value" });
    expect(parseGimmickRekapFilters({ item: "x", mode: "rupiah" }, "2026-09-27")).toEqual({
      from: "2026-04",
      to: "2026-09",
      mode: "qty",
    });
  });

  it("round-trips through the query string, dropping the default qty mode", () => {
    const filters = { from: "2026-01", to: "2026-03", program: "Imlek 2027", mode: "value" as const };
    const qs = gimmickRekapFiltersQuery(filters);
    expect(qs).toBe("from=2026-01&to=2026-03&program=Imlek+2027&mode=value");
    expect(parseGimmickRekapFilters(Object.fromEntries(new URLSearchParams(qs)), "2026-09-27")).toEqual(filters);
    expect(gimmickRekapFiltersQuery({ ...filters, mode: "qty" })).not.toContain("mode");
  });
});

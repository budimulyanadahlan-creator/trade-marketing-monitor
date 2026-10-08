import { describe, it, expect } from "vitest";
import {
  aggregateOutRekap,
  auditChanges,
  auditFiltersQuery,
  auditRecordLabel,
  formatAuditValue,
  parseAuditFilters,
  POSM_AUDIT_FIELD_LABELS,
  POSM_AUDIT_TABLE_LABELS,
  POSM_AUDIT_TABLES,
  availableFrom,
  balanceOf,
  canManagePosm,
  findBalanceViolation,
  monthDateBounds,
  monthRange,
  movementFiltersQuery,
  nextCode,
  placementDateViolation,
  withPreviousPlacement,
  summarizeAssets,
  summarizeAssetStock,
  resolveAssetView,
  parseAssetListFilters,
  assetListFiltersQuery,
  EMPTY_ASSET_LIST_FILTERS,
  matchesAssetListFilters,
  stockCellFilters,
  parseMovementFilters,
  parseRekapFilters,
  parsePosmExportParams,
  posmExportHref,
  withRunningBalance,
  signedQuantity,
  stockStatus,
} from "./posm";

const mv = (movement_date: string, quantity: number) => ({ movement_date, quantity });

describe("balanceOf", () => {
  it("sums signed quantities", () => {
    expect(balanceOf([mv("2026-01-01", 100), mv("2026-01-05", -30), mv("2026-01-06", 5)])).toBe(75);
  });

  it("is zero without movements", () => {
    expect(balanceOf([])).toBe(0);
  });
});

describe("findBalanceViolation", () => {
  it("returns null when the running balance never goes negative", () => {
    expect(findBalanceViolation([mv("2026-01-01", 100), mv("2026-01-05", -100)])).toBeNull();
  });

  it("flags an out that exceeds the balance", () => {
    expect(findBalanceViolation([mv("2026-01-01", 100), mv("2026-01-05", -120)])).toEqual({
      date: "2026-01-05",
      balance: -20,
    });
  });

  it("flags a backdated out before the stock came in, even if the final balance is positive", () => {
    expect(findBalanceViolation([mv("2026-01-10", 100), mv("2026-01-05", -30)])).toEqual({
      date: "2026-01-05",
      balance: -30,
    });
  });

  it("nets movements on the same day regardless of entry order", () => {
    expect(findBalanceViolation([mv("2026-01-05", -30), mv("2026-01-05", 50)])).toBeNull();
  });

  it("flags a later day that goes negative after an earlier in is reduced", () => {
    // Masuk diedit dari 100 menjadi 40, padahal sudah keluar 50.
    expect(findBalanceViolation([mv("2026-01-01", 40), mv("2026-01-03", -50), mv("2026-01-09", 20)])).toEqual({
      date: "2026-01-03",
      balance: -10,
    });
  });
});

describe("availableFrom", () => {
  const history = [mv("2026-01-01", 100), mv("2026-01-10", -80), mv("2026-01-20", 50)];

  it("is the lowest running balance from that date onward", () => {
    // Per 5 Jan saldo 100, tapi 10 Jan turun ke 20 → hanya 20 yang aman dikeluarkan.
    expect(availableFrom(history, "2026-01-05")).toBe(20);
  });

  it("uses the balance at the date when nothing happens afterwards", () => {
    expect(availableFrom(history, "2026-01-25")).toBe(70);
  });

  it("is zero before any stock exists", () => {
    expect(availableFrom(history, "2025-12-31")).toBe(0);
  });
});

describe("signedQuantity", () => {
  it("keeps opening and in positive", () => {
    expect(signedQuantity("opening", 100)).toBe(100);
    expect(signedQuantity("in", 25)).toBe(25);
  });

  it("makes out negative", () => {
    expect(signedQuantity("out", 30)).toBe(-30);
  });

  it("signs an adjustment by its direction", () => {
    expect(signedQuantity("adjustment", 5, "plus")).toBe(5);
    expect(signedQuantity("adjustment", 5, "minus")).toBe(-5);
  });

  it("treats the entered quantity as a magnitude", () => {
    expect(signedQuantity("out", -30)).toBe(-30);
    expect(signedQuantity("in", -25)).toBe(25);
  });
});

describe("stockStatus", () => {
  it("is habis when the balance is zero", () => {
    expect(stockStatus(0, 10)).toBe("habis");
    expect(stockStatus(0, null)).toBe("habis");
  });

  it("is menipis when the balance is at or below the minimum stock", () => {
    expect(stockStatus(10, 10)).toBe("menipis");
    expect(stockStatus(3, 10)).toBe("menipis");
  });

  it("is aman above the minimum, or when no minimum is set", () => {
    expect(stockStatus(11, 10)).toBe("aman");
    expect(stockStatus(1, null)).toBe("aman");
  });
});

describe("nextCode", () => {
  it("returns the number after the largest standard code", () => {
    expect(nextCode("POSM", ["POSM-0001", "POSM-0007", "POSM-0003"])).toBe("POSM-0008");
  });

  it("starts at 0001 when there are no codes yet", () => {
    expect(nextCode("POSM", [])).toBe("POSM-0001");
  });

  it("ignores manually typed codes that do not follow the standard format", () => {
    expect(nextCode("POSM", ["WBL-99", "POSM-0002", "POSM-ABC", "XPOSM-0050"])).toBe("POSM-0003");
  });

  it("keeps counting past 9999 without truncating", () => {
    expect(nextCode("AST", ["AST-9999"])).toBe("AST-10000");
  });
});

describe("canManagePosm", () => {
  it("allows a user from the Trade Marketing department", () => {
    expect(canManagePosm({ role: "user", departmentName: "Trade Marketing" })).toBe(true);
  });

  it("allows a manager from the Marketing department, case-insensitively", () => {
    expect(canManagePosm({ role: "manager", departmentName: "  MARKETING " })).toBe(true);
  });

  it("allows admin and superadmin from any department", () => {
    expect(canManagePosm({ role: "admin", departmentName: "Finance" })).toBe(true);
    expect(canManagePosm({ role: "superadmin", departmentName: null })).toBe(true);
  });

  it("denies users from other departments and finance", () => {
    expect(canManagePosm({ role: "user", departmentName: "Sales" })).toBe(false);
    expect(canManagePosm({ role: "finance", departmentName: "Finance" })).toBe(false);
    expect(canManagePosm({ role: "manager", departmentName: null })).toBe(false);
  });

  it("denies a distributor even if linked to a Marketing department", () => {
    expect(canManagePosm({ role: "distributor", departmentName: "Marketing" })).toBe(false);
  });
});

describe("withRunningBalance", () => {
  it("adds the running balance in date order, then entry order within a day", () => {
    const rows = withRunningBalance([
      { id: "c", movement_date: "2026-01-05", quantity: -30, created_at: "2026-01-05T10:00:00Z" },
      { id: "a", movement_date: "2026-01-01", quantity: 100, created_at: "2026-01-06T00:00:00Z" },
      { id: "b", movement_date: "2026-01-05", quantity: 20, created_at: "2026-01-05T08:00:00Z" },
    ]);

    expect(rows.map((r) => [r.id, r.running_balance])).toEqual([
      ["a", 100],
      ["b", 120],
      ["c", 90],
    ]);
  });
});

describe("parseMovementFilters", () => {
  const UUID = "44444444-4444-4444-8444-444444444444";

  it("keeps valid filters and defaults to page 1", () => {
    expect(
      parseMovementFilters({
        from: "2026-01-01",
        to: "2026-03-31",
        type: "out",
        item: UUID,
        region: UUID,
        distributor: UUID,
      })
    ).toEqual({ from: "2026-01-01", to: "2026-03-31", type: "out", item: UUID, region: UUID, distributor: UUID, page: 1 });
  });

  it("drops malformed values instead of failing the query", () => {
    expect(
      parseMovementFilters({ from: "kemarin", type: "transfer", item: "abc", region: ["x", "y"], page: "-3" })
    ).toEqual({ page: 1 });
  });

  it("reads the page number", () => {
    expect(parseMovementFilters({ page: "4" })).toEqual({ page: 4 });
  });
});

describe("movementFiltersQuery", () => {
  it("serialises filters, omitting page 1 and empty values", () => {
    expect(movementFiltersQuery({ type: "out", region: "r1", page: 1 })).toBe("type=out&region=r1");
    expect(movementFiltersQuery({ from: "2026-01-01", page: 3 })).toBe("from=2026-01-01&page=3");
  });
});

describe("aggregateOutRekap", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const out = (item_code: string, region_name: string, movement_date: string, quantity: number, type = "out") => ({
    item_id: item_code,
    item_code,
    item_name: `Item ${item_code}`,
    unit: "pcs",
    region_id: region_name,
    region_name,
    movement_date,
    type: type as "opening" | "in" | "out" | "adjustment",
    quantity,
  });

  it("sums absolute out quantities per item × region × month with row, column and grand totals", () => {
    const rekap = aggregateOutRekap(
      [
        out("P1", "Jawa", "2026-01-05", -10),
        out("P1", "Jawa", "2026-01-20", -5),
        out("P1", "Jawa", "2026-03-01", -7),
        out("P1", "Bali", "2026-02-10", -3),
      ],
      months
    );

    expect(rekap.rows.map((r) => [r.item_code, r.region_name, r.months, r.total])).toEqual([
      ["P1", "Bali", [0, 3, 0], 3],
      ["P1", "Jawa", [15, 0, 7], 22],
    ]);
    expect(rekap.monthTotals).toEqual([15, 3, 7]);
    expect(rekap.grandTotal).toBe(25);
  });

  it("ignores opening, in and adjustment movements, and months outside the range", () => {
    const rekap = aggregateOutRekap(
      [
        out("P1", "Jawa", "2026-01-01", 100, "opening"),
        out("P1", "Jawa", "2026-01-02", 50, "in"),
        out("P1", "Jawa", "2026-01-03", -4, "adjustment"),
        out("P1", "Jawa", "2025-12-31", -9),
        out("P1", "Jawa", "2026-04-01", -9),
      ],
      months
    );

    expect(rekap).toEqual({ rows: [], monthTotals: [0, 0, 0], grandTotal: 0 });
  });
});

describe("parseRekapFilters", () => {
  const UUID = "44444444-4444-4444-8444-444444444444";
  const today = "2026-09-27";

  it("defaults to the last 6 months including the current month", () => {
    expect(parseRekapFilters({}, today)).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("keeps valid months and item/brand filters", () => {
    expect(parseRekapFilters({ from: "2026-01", to: "2026-03", item: UUID, brand: UUID }, today)).toEqual({
      from: "2026-01",
      to: "2026-03",
      item: UUID,
      brand: UUID,
    });
  });

  it("swaps a reversed range and drops malformed values", () => {
    expect(parseRekapFilters({ from: "2026-05", to: "2026-02", item: "abc", brand: ["x"] }, today)).toEqual({
      from: "2026-02",
      to: "2026-05",
    });
    expect(parseRekapFilters({ from: "2026-13", to: "Mei" }, today)).toEqual({ from: "2026-04", to: "2026-09" });
  });

  it("caps the range at 24 months counted back from the end month", () => {
    expect(parseRekapFilters({ from: "2020-01", to: "2026-09" }, today)).toEqual({ from: "2024-10", to: "2026-09" });
  });
});

describe("monthRange", () => {
  it("lists months inclusively across a year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("gives the first and last day for the date filter", () => {
    expect(monthDateBounds("2026-01", "2026-02")).toEqual({ start: "2026-01-01", end: "2026-02-28" });
    expect(monthDateBounds("2024-02", "2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
});

describe("summarizeAssets", () => {
  const asset = (acquisition_value: number, condition: string, destination: "warehouse" | "placed") => ({
    acquisition_value,
    condition: condition as "Baik",
    destination,
  });

  it("counts units, totals acquisition value, and splits by condition and location", () => {
    const summary = summarizeAssets([
      asset(5_000_000, "Baik", "placed"),
      asset(2_500_000, "Baik", "warehouse"),
      asset(1_000_000, "Rusak Ringan", "placed"),
    ]);

    expect(summary.totalUnits).toBe(3);
    expect(summary.totalValue).toBe(8_500_000);
    expect(summary.byCondition).toEqual({
      Baik: 2,
      "Rusak Ringan": 1,
      "Rusak Berat": 0,
      Hilang: 0,
      Dihapusbukukan: 0,
    });
    expect(summary.inWarehouse).toBe(1);
    expect(summary.placed).toBe(2);
  });

  it("leaves written-off assets out of the totals but still counts them by condition", () => {
    const summary = summarizeAssets([
      asset(5_000_000, "Baik", "placed"),
      asset(2_000_000, "Dihapusbukukan", "warehouse"),
    ]);

    expect(summary.totalUnits).toBe(1);
    expect(summary.totalValue).toBe(5_000_000);
    expect(summary.inWarehouse).toBe(0);
    expect(summary.placed).toBe(1);
    expect(summary.byCondition.Dihapusbukukan).toBe(1);
  });

  it("returns zeros for no assets", () => {
    const summary = summarizeAssets([]);
    expect(summary.totalUnits).toBe(0);
    expect(summary.totalValue).toBe(0);
    expect(summary.inWarehouse + summary.placed).toBe(0);
  });
});

describe("withPreviousPlacement", () => {
  const pl = (id: string, event_date: string, created_at: string, is_registration = false) => ({
    id,
    event_date,
    created_at,
    is_registration,
  });

  it("orders history chronologically and links each record to the one before it", () => {
    const history = withPreviousPlacement([
      pl("move-2", "2026-03-01", "2026-03-01T10:00:00Z"),
      pl("reg", "2026-01-01", "2026-01-01T08:00:00Z", true),
      pl("move-1", "2026-02-01", "2026-02-01T09:00:00Z"),
    ]);

    expect(history.map((h) => h.id)).toEqual(["reg", "move-1", "move-2"]);
    expect(history.map((h) => h.previous?.id ?? null)).toEqual([null, "reg", "move-1"]);
  });

  it("puts a move on the registration date after the registration", () => {
    const history = withPreviousPlacement([
      pl("move", "2026-01-01", "2026-01-01T07:00:00Z"),
      pl("reg", "2026-01-01", "2026-01-01T08:00:00Z", true),
    ]);
    expect(history.map((h) => h.id)).toEqual(["reg", "move"]);
  });
});

describe("placementDateViolation", () => {
  const existing = [
    { id: "reg", event_date: "2026-02-01", is_registration: true },
    { id: "move", event_date: "2026-03-01", is_registration: false },
  ];

  it("rejects a move dated before the registration", () => {
    expect(placementDateViolation(existing, { event_date: "2026-01-31" })).toEqual({
      kind: "before_registration",
      date: "2026-02-01",
    });
    expect(placementDateViolation(existing, { event_date: "2026-02-01" })).toBeNull();
  });

  it("applies the same rule when editing a move", () => {
    expect(placementDateViolation(existing, { id: "move", event_date: "2026-01-15" })?.kind).toBe(
      "before_registration"
    );
  });

  it("rejects moving the registration date past the first move", () => {
    expect(placementDateViolation(existing, { id: "reg", event_date: "2026-03-02" })).toEqual({
      kind: "registration_after_move",
      date: "2026-03-01",
    });
    expect(placementDateViolation(existing, { id: "reg", event_date: "2026-03-01" })).toBeNull();
  });
});

describe("auditChanges", () => {
  it("lists only changed fields on update, ignoring bookkeeping columns", () => {
    const old = { id: "x", name: "Poster A", min_stock: 10, updated_at: "t1", updated_by: "u1" };
    const next = { id: "x", name: "Poster B", min_stock: 10, updated_at: "t2", updated_by: "u2" };
    expect(auditChanges("update", old, next)).toEqual([{ field: "name", old: "Poster A", new: "Poster B" }]);
  });

  it("lists every filled field on insert", () => {
    expect(
      auditChanges("insert", null, { id: "x", code: "POSM-0001", brand_id: null, is_active: true, created_at: "t" })
    ).toEqual([
      { field: "code", old: null, new: "POSM-0001" },
      { field: "is_active", old: null, new: true },
    ]);
  });

  it("shows deleted_at on soft delete", () => {
    expect(auditChanges("soft_delete", { deleted_at: null, qty: 1 }, { deleted_at: "2026-09-01", qty: 1 })).toEqual([
      { field: "deleted_at", old: null, new: "2026-09-01" },
    ]);
  });
});

describe("parseAuditFilters", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("keeps valid values and drops invalid ones", () => {
    expect(
      parseAuditFilters({
        table: "posm_movements",
        action: "soft_delete",
        actor: uuid,
        record: uuid,
        from: "2026-09-01",
        to: "bukan-tanggal",
        page: "3",
      })
    ).toEqual({ table: "posm_movements", action: "soft_delete", actor: uuid, record: uuid, from: "2026-09-01", page: 3 });
    expect(parseAuditFilters({ table: "users", action: "delete", actor: "x", page: "0" })).toEqual({ page: 1 });
  });

  it("round-trips through the query string without page 1", () => {
    const filters = parseAuditFilters({ table: "marketing_assets", record: uuid });
    expect(auditFiltersQuery(filters)).toBe(`table=marketing_assets&record=${uuid}`);
    expect(auditFiltersQuery({ ...filters, page: 2 })).toBe(`table=marketing_assets&record=${uuid}&page=2`);
  });
});

describe("formatAuditValue", () => {
  const names = new Map([["r1", "Jawa Barat"]]);

  it("renders values readably", () => {
    expect(formatAuditValue("notes", null, names)).toBe("—");
    expect(formatAuditValue("is_active", false, names)).toBe("Tidak");
    expect(formatAuditValue("type", "out", names)).toBe("Keluar");
    expect(formatAuditValue("destination", "warehouse", names)).toBe("Gudang Pusat");
    expect(formatAuditValue("acquisition_value", 1500000, names)).toMatch(/^Rp\s?1\.500\.000$/);
    expect(formatAuditValue("quantity", -1200, names)).toBe("-1.200");
    expect(formatAuditValue("movement_date", "2026-09-05", names)).toBe("5 Sep 2026");
  });

  it("resolves referenced ids through the lookup and falls back to the raw id", () => {
    expect(formatAuditValue("region_id", "r1", names)).toBe("Jawa Barat");
    expect(formatAuditValue("distributor_id", "d9", names)).toBe("d9");
  });
});

describe("auditRecordLabel", () => {
  const names = new Map([
    ["i1", "POSM-0001 — Poster Promo"],
    ["a1", "AST-0001 — Chiller"],
  ]);

  it("uses code and name for master records", () => {
    expect(auditRecordLabel("posm_items", { code: "POSM-0002", name: "Wobbler" }, names)).toBe("POSM-0002 — Wobbler");
  });

  it("describes movements and placements with their parent", () => {
    expect(auditRecordLabel("posm_movements", { item_id: "i1", type: "out", quantity: -20 }, names)).toBe(
      "Keluar -20 • POSM-0001 — Poster Promo"
    );
    expect(
      auditRecordLabel("asset_placements", { asset_id: "a1", destination: "placed", store_name: "Toko Maju" }, names)
    ).toBe("Ditempatkan: Toko Maju • AST-0001 — Chiller");
    expect(auditRecordLabel("asset_placements", { asset_id: "a1", destination: "warehouse" }, names)).toBe(
      "Gudang Pusat • AST-0001 — Chiller"
    );
  });
});

describe("audit gimmick", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const names = new Map([
    ["g1", "GMK-0001 — Payung Wangzai"],
    ["r1", "Jawa Barat"],
  ]);

  it("menerima filter tabel gimmick dengan label yang terbaca", () => {
    expect(parseAuditFilters({ table: "gimmick_items", record: uuid })).toEqual({
      table: "gimmick_items",
      record: uuid,
      page: 1,
    });
    expect(parseAuditFilters({ table: "gimmick_movements" }).table).toBe("gimmick_movements");
    expect(POSM_AUDIT_TABLE_LABELS.gimmick_items).toBe("Item Gimmick");
    expect(POSM_AUDIT_TABLE_LABELS.gimmick_movements).toBe("Mutasi Gimmick");
  });

  it("memberi label field khusus gimmick", () => {
    expect(POSM_AUDIT_FIELD_LABELS.unit_cost).toBe("Harga Pokok");
    expect(POSM_AUDIT_FIELD_LABELS.suggested_price).toBe("Harga Jual Saran");
    expect(POSM_AUDIT_FIELD_LABELS.unit_cost_snapshot).toBe("Harga Snapshot");
    expect(POSM_AUDIT_FIELD_LABELS.pcs_per_carton).toBe("Isi per Karton");
    expect(POSM_AUDIT_FIELD_LABELS.program).toBe("Program");
    expect(POSM_AUDIT_FIELD_LABELS.recipient_name).toBe("PIC / Penerima");
  });

  it("memformat harga sebagai Rupiah dan tujuan Keluar gimmick", () => {
    expect(formatAuditValue("unit_cost", 25000, names)).toMatch(/^Rp\s?25\.000$/);
    expect(formatAuditValue("unit_cost_snapshot", "12500.00", names)).toMatch(/^Rp\s?12\.500$/);
    expect(formatAuditValue("suggested_price", 30000, names)).toMatch(/^Rp\s?30\.000$/);
    expect(formatAuditValue("destination", "region_distributor", names)).toBe("Region/Distributor");
    expect(formatAuditValue("destination", "event", names)).toBe("Event/Pameran");
    expect(formatAuditValue("destination", "warehouse", names)).toBe("Gudang Pusat");
    expect(formatAuditValue("pcs_per_carton", 24, names)).toBe("24");
  });

  it("melabeli record gimmick dari snapshot audit", () => {
    expect(auditRecordLabel("gimmick_items", { code: "GMK-0002", name: "Tas Kanvas" }, names)).toBe(
      "GMK-0002 — Tas Kanvas"
    );
    expect(
      auditRecordLabel("gimmick_movements", { item_id: "g1", type: "out", quantity: -24, destination: "event" }, names)
    ).toBe("Keluar -24 • GMK-0001 — Payung Wangzai");
  });

  it("melabeli record jenis asset dengan namanya", () => {
    expect(auditRecordLabel("asset_types", { id: "t1", name: "Seragam/Pakaian" }, names)).toBe("Seragam/Pakaian");
    expect(POSM_AUDIT_TABLES).toContain("asset_types");
  });
});

describe("posmExportHref / parsePosmExportParams", () => {
  const ITEM = "11111111-1111-1111-1111-111111111111";
  const BRAND = "22222222-2222-2222-2222-222222222222";

  it("membawa filter mutasi dan rekap aktif, lalu dibaca kembali tanpa halaman", () => {
    const href = posmExportHref({
      movements: { from: "2026-09-01", type: "out", item: ITEM, page: 3 },
      rekap: { from: "2026-01", to: "2026-03", brand: BRAND },
    });
    expect(href.startsWith("/api/export/monitoring-posm?")).toBe(true);

    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    const parsed = parsePosmExportParams(params, "2026-09-27");
    expect(parsed.movements).toEqual({ from: "2026-09-01", type: "out", item: ITEM, page: 1 });
    expect(parsed.rekap).toEqual({ from: "2026-01", to: "2026-03", brand: BRAND });
  });

  it("tanpa parameter: semua mutasi dan rekap default 6 bulan terakhir", () => {
    expect(posmExportHref({})).toBe("/api/export/monitoring-posm");
    const parsed = parsePosmExportParams({}, "2026-09-27");
    expect(parsed.movements).toEqual({ page: 1 });
    expect(parsed.rekap).toEqual({ from: "2026-04", to: "2026-09" });
  });
});

describe("summarizeAssetStock", () => {
  type Row = Parameters<typeof summarizeAssetStock>[0][number];
  const unit = (over: Partial<Row>): Row => ({
    asset_type_id: "type-seragam",
    asset_type_name: "Seragam/Pakaian",
    name: "T-Shirt SPG",
    brand_id: null,
    region_id: null,
    acquisition_value: 100_000,
    condition: "Baik",
    destination: "warehouse",
    ...over,
  });
  const noFilter = { brandId: "", regionId: "", condition: "" };

  it("groups units by type then by name, counting location and value", () => {
    const result = summarizeAssetStock(
      [
        unit({ name: "T-Shirt SPG Kuning" }),
        unit({ name: "T-Shirt SPG Hitam", destination: "placed", region_id: "reg-1" }),
        unit({ name: "T-Shirt SPG Putih", destination: "placed", region_id: "reg-1", acquisition_value: 150_000 }),
      ],
      noFilter
    );
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group).toMatchObject({
      typeId: "type-seragam",
      typeName: "Seragam/Pakaian",
      counts: { total: 3, warehouse: 1, placed: 2, damaged: 0, lost: 0, value: 350_000 },
    });
    expect(group.names.map((n) => [n.name, n.counts.total])).toEqual([
      ["T-Shirt SPG Hitam", 1],
      ["T-Shirt SPG Kuning", 1],
      ["T-Shirt SPG Putih", 1],
    ]);
  });

  const mixed = [
    unit({ condition: "Baik" }),
    unit({ condition: "Rusak Ringan", destination: "placed", region_id: "reg-1" }),
    unit({ condition: "Rusak Berat" }),
    unit({ condition: "Hilang", destination: "placed", region_id: "reg-2" }),
    unit({ condition: "Dihapusbukukan", acquisition_value: 999_000 }),
  ];

  it("excludes written-off units by default and counts damaged and lost", () => {
    expect(summarizeAssetStock(mixed, noFilter).total).toEqual({
      total: 4,
      warehouse: 2,
      placed: 2,
      damaged: 2,
      lost: 1,
      value: 400_000,
    });
  });

  it("includes every condition with the 'all' filter, or only the chosen one", () => {
    expect(summarizeAssetStock(mixed, { ...noFilter, condition: "all" }).total.total).toBe(5);
    expect(summarizeAssetStock(mixed, { ...noFilter, condition: "Dihapusbukukan" }).total).toMatchObject({
      total: 1,
      value: 999_000,
    });
  });

  it("matches both damaged conditions with the 'rusak' filter", () => {
    expect(summarizeAssetStock(mixed, { ...noFilter, condition: "rusak" }).total).toMatchObject({ total: 2, damaged: 2 });
  });

  it("counts only units placed in the chosen region, so the warehouse column is zero", () => {
    const total = summarizeAssetStock(mixed, { ...noFilter, regionId: "reg-1" }).total;
    expect(total).toMatchObject({ total: 1, warehouse: 0, placed: 1, damaged: 1 });
  });

  it("filters by brand and drops types left without units", () => {
    const result = summarizeAssetStock(
      [
        unit({ brand_id: "brand-1" }),
        unit({ brand_id: "brand-2" }),
        unit({ asset_type_id: "type-cooler", asset_type_name: "Cooler/Chiller", name: "Cooler", brand_id: "brand-2" }),
      ],
      { ...noFilter, brandId: "brand-1" }
    );
    expect(result.groups.map((g) => [g.typeName, g.counts.total])).toEqual([["Seragam/Pakaian", 1]]);
  });

  it("sorts types by name and makes the grand total equal the sum of the types", () => {
    const result = summarizeAssetStock(
      [
        unit({}),
        unit({ asset_type_id: "type-cooler", asset_type_name: "Cooler/Chiller", name: "Cooler", acquisition_value: 5_000_000 }),
        unit({ asset_type_id: "type-cooler", asset_type_name: "Cooler/Chiller", name: "Cooler", destination: "placed" }),
      ],
      noFilter
    );
    expect(result.groups.map((g) => g.typeName)).toEqual(["Cooler/Chiller", "Seragam/Pakaian"]);
    expect(result.groups[0].names).toEqual([
      { name: "Cooler", counts: { total: 2, warehouse: 1, placed: 1, damaged: 0, lost: 0, value: 5_100_000 } },
    ]);
    const summed = result.groups.reduce((s, g) => s + g.counts.total, 0);
    expect(result.total.total).toBe(summed);
    expect(result.total.value).toBe(5_200_000);
  });
});

describe("parseAssetListFilters / assetListFiltersQuery", () => {
  it("reads type, exact name, brand, region, condition, and location from the URL", () => {
    const filters = parseAssetListFilters({
      tab: "asset",
      jenis: "type-seragam",
      nama: "T-Shirt SPG Hitam",
      brand: "brand-1",
      region: "reg-1",
      kondisi: "rusak",
      lokasi: "placed",
    });
    expect(filters).toEqual({
      typeId: "type-seragam",
      name: "T-Shirt SPG Hitam",
      brandId: "brand-1",
      regionId: "reg-1",
      condition: "rusak",
      location: "placed",
    });
    expect(parseAssetListFilters(Object.fromEntries(new URLSearchParams(assetListFiltersQuery(filters))))).toEqual(
      filters
    );
  });

  it("ignores unknown condition and location values and drops empty filters from the query", () => {
    expect(parseAssetListFilters({ kondisi: "Rusak", lokasi: "gudang", nama: ["A", "B"] })).toEqual({
      ...EMPTY_ASSET_LIST_FILTERS,
      name: "A",
    });
    expect(parseAssetListFilters({ kondisi: "Hilang" }).condition).toBe("Hilang");
    expect(assetListFiltersQuery(EMPTY_ASSET_LIST_FILTERS)).toBe("");
    expect(assetListFiltersQuery({ ...EMPTY_ASSET_LIST_FILTERS, name: "Kaos & Topi" })).toBe("nama=Kaos+%26+Topi");
  });
});

describe("stockCellFilters", () => {
  type Row = Parameters<typeof summarizeAssetStock>[0][number];
  const unit = (over: Partial<Row>): Row => ({
    asset_type_id: "type-seragam",
    asset_type_name: "Seragam/Pakaian",
    name: "T-Shirt SPG Hitam",
    brand_id: "brand-1",
    region_id: null,
    acquisition_value: 100_000,
    condition: "Baik",
    destination: "warehouse",
    ...over,
  });
  const units = [
    unit({}),
    unit({ destination: "placed", region_id: "reg-1" }),
    unit({ name: "T-Shirt SPG Kuning", condition: "Rusak Ringan", destination: "placed", region_id: "reg-1" }),
    unit({ name: "T-Shirt SPG Kuning", condition: "Rusak Berat", brand_id: "brand-2" }),
    unit({ name: "T-Shirt SPG Kuning", condition: "Hilang", destination: "placed", region_id: "reg-2" }),
    unit({ name: "T-Shirt SPG Kuning", condition: "Dihapusbukukan" }),
    unit({ asset_type_id: "type-cooler", asset_type_name: "Cooler/Chiller", name: "T-Shirt SPG Hitam" }),
  ];
  const columns = ["total", "warehouse", "placed", "damaged", "lost"] as const;
  const shared = [
    { brandId: "", regionId: "", condition: "" },
    { brandId: "", regionId: "", condition: "all" },
    { brandId: "", regionId: "", condition: "Rusak Ringan" },
    { brandId: "", regionId: "reg-1", condition: "" },
    { brandId: "brand-1", regionId: "", condition: "rusak" },
  ];

  // Angka 0 tidak ditautkan, jadi hanya angka > 0 yang harus cocok.
  it("lists exactly as many units as the clicked number, for every non-zero cell and filter", () => {
    for (const filters of shared) {
      const summary = summarizeAssetStock(units, filters);
      const cells = [
        { cell: {}, counts: summary.total },
        ...summary.groups.flatMap((g) => [
          { cell: { typeId: g.typeId }, counts: g.counts },
          ...g.names.map((n) => ({ cell: { typeId: g.typeId, name: n.name }, counts: n.counts })),
        ]),
      ];
      for (const { cell, counts } of cells) {
        for (const column of columns) {
          if (counts[column] === 0) continue;
          const listed = units.filter((u) => matchesAssetListFilters(u, stockCellFilters(filters, cell, column)));
          expect(listed.length, `${JSON.stringify({ filters, cell, column })}`).toBe(counts[column]);
        }
      }
    }
  });

  it("carries type, exact name, brand, and region, and maps columns to location or condition", () => {
    const base = { brandId: "brand-1", regionId: "reg-1", condition: "" };
    const cell = { typeId: "type-seragam", name: "T-Shirt SPG Hitam" };
    expect(stockCellFilters(base, cell, "placed")).toEqual({
      typeId: "type-seragam",
      name: "T-Shirt SPG Hitam",
      brandId: "brand-1",
      regionId: "reg-1",
      condition: "",
      location: "placed",
    });
    expect(stockCellFilters(base, {}, "damaged")).toMatchObject({ typeId: "", name: "", condition: "rusak", location: "" });
    expect(stockCellFilters(base, {}, "lost").condition).toBe("Hilang");
  });
});

describe("resolveAssetView", () => {
  it("opens the stock summary only for view=ringkasan, defaulting to the unit list", () => {
    expect(resolveAssetView("ringkasan")).toBe("ringkasan");
    expect(resolveAssetView(undefined)).toBe("daftar");
    expect(resolveAssetView("lain")).toBe("daftar");
    expect(resolveAssetView(["ringkasan"])).toBe("ringkasan");
  });
});

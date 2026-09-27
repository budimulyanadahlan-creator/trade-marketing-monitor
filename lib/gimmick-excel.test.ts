import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { addGimmickSheets, GIMMICK_SHEET_NAMES, type GimmickExportData } from "./gimmick-excel";
import type { GimmickRekapMovement } from "./gimmick";

function out(overrides: Partial<GimmickRekapMovement>): GimmickRekapMovement {
  return {
    item_id: "item-1",
    item_code: "GMK-0001",
    item_name: "Payung Wangzai",
    unit: "pcs",
    program: "Imlek 2027",
    region_id: "reg-1",
    region_name: "Jawa Barat",
    destination: "region_distributor",
    movement_date: "2026-09-10",
    type: "out",
    quantity: -30,
    unit_cost_snapshot: 25_000,
    ...overrides,
  };
}

function data(overrides: Partial<GimmickExportData> = {}): GimmickExportData {
  return {
    balances: [],
    movements: [],
    movementFilterLabel: "Semua mutasi",
    rekap: { months: ["2026-08", "2026-09"], movements: [], filterLabel: "" },
    ...overrides,
  };
}

function sheet(d: GimmickExportData, name: string) {
  const wb = new ExcelJS.Workbook();
  addGimmickSheets(wb, d);
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`sheet ${name} tidak ada`);
  return ws;
}

describe("addGimmickSheets", () => {
  it("adds the five gimmick sheets in order", () => {
    const wb = new ExcelJS.Workbook();
    addGimmickSheets(wb, data());
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([...GIMMICK_SHEET_NAMES]);
    expect(GIMMICK_SHEET_NAMES).toEqual([
      "Saldo Gimmick",
      "Mutasi Gimmick",
      "Rekap Gimmick per Region",
      "Rekap Gimmick per Tujuan",
      "Rekap Gimmick per Program",
    ]);
  });

  it("writes balances with carton breakdown, rupiah value, and a total stock value row", () => {
    const ws = sheet(
      data({
        balances: [
          {
            code: "GMK-0001",
            name: "Payung Wangzai",
            program: "Imlek 2027",
            brand_name: "Wangzai",
            category: "Payung",
            unit: "pcs",
            pcs_per_carton: 24,
            balance: 77,
            unit_cost: 25_000,
            stock_value: 1_925_000,
            min_stock: 100,
            stock_status: "menipis",
            is_active: true,
            last_movement_date: "2026-09-10",
          },
          {
            code: "GMK-0002",
            name: "Tas Kanvas",
            program: null,
            brand_name: null,
            category: "Tas",
            unit: "pcs",
            pcs_per_carton: null,
            balance: 10,
            unit_cost: 15_000,
            stock_value: 150_000,
            min_stock: null,
            stock_status: "aman",
            is_active: false,
            last_movement_date: null,
          },
        ],
      }),
      "Saldo Gimmick"
    );

    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Kode");
    expect(header.getCell(11).value).toBe("Nilai Stok (Rp)");

    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe("GMK-0001");
    expect(row.getCell(3).value).toBe("Imlek 2027");
    expect(row.getCell(7).value).toBe(24);
    expect(row.getCell(8).value).toBe(77);
    expect(row.getCell(9).value).toBe("77 pcs (3 krt + 5 pcs)");
    expect(row.getCell(10).value).toBe(25_000);
    expect(row.getCell(10).numFmt).toContain("Rp");
    expect(row.getCell(11).value).toBe(1_925_000);
    expect(row.getCell(13).value).toBe("Menipis");
    expect(row.getCell(14).value).toBe("Aktif");
    expect(row.getCell(15).value).toEqual(new Date(Date.UTC(2026, 8, 10)));

    expect(ws.getRow(3).getCell(9).value).toBe("10 pcs");
    expect(ws.getRow(3).getCell(14).value).toBe("Nonaktif");

    const total = ws.getRow(4);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.getCell(11).value).toBe(2_075_000);
  });

  it("writes movements under the filter caption with signed qty, snapshot value, and destination", () => {
    const ws = sheet(
      data({
        movementFilterLabel: "Tipe: Keluar",
        movements: [
          {
            movement_date: "2026-09-10",
            item_code: "GMK-0001",
            item_name: "Payung Wangzai",
            program: "Imlek 2027",
            unit: "pcs",
            pcs_per_carton: 24,
            type: "out",
            quantity: -30,
            unit_cost_snapshot: 25_000,
            destination: "event",
            region_name: "Jawa Barat",
            distributor_name: null,
            campaign_skp: "SKP-0007",
            campaign_name: "Promo Imlek",
            recipient_name: "Andi",
            notes: "Pameran Jakarta Fair",
            created_by_name: "Budi",
          },
        ],
      }),
      "Mutasi Gimmick"
    );

    expect(ws.getCell("A1").value).toBe("Filter: Tipe: Keluar");
    expect(ws.getRow(3).getCell(1).value).toBe("Tanggal");
    const row = ws.getRow(4);
    expect(row.getCell(5).value).toBe("Keluar");
    expect(row.getCell(6).value).toBe(-30);
    expect(row.getCell(7).value).toBe("-30 pcs (1 krt + 6 pcs)");
    expect(row.getCell(9).value).toBe(25_000);
    expect(row.getCell(10).value).toBe(-750_000);
    expect(row.getCell(11).value).toBe("Event/Pameran");
    expect(row.getCell(12).value).toBe("Jawa Barat");
    expect(row.getCell(14).value).toBe("SKP-0007");
    expect(row.getCell(16).value).toBe("Andi");
    expect(row.getCell(17).value).toBe("Pameran Jakarta Fair");
  });

  describe("rekap sheets (qty block then value block)", () => {
    const movements = [
      out({ movement_date: "2026-08-05", quantity: -10 }),
      out({ quantity: -30, unit_cost_snapshot: 20_000 }),
      out({ destination: "internal", region_id: null, region_name: null, program: null, quantity: -5 }),
      out({ type: "adjustment", quantity: -3 }),
    ];
    const d = data({ rekap: { months: ["2026-08", "2026-09"], movements, filterLabel: "Program: Imlek 2027" } });

    /** Baris pertama yang sel A-nya sama dengan `label`, mulai dari baris `from`. */
    function findRow(ws: ExcelJS.Worksheet, label: string, from = 1) {
      for (let r = from; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(1).value === label) return r;
      throw new Error(`baris ${label} tidak ada`);
    }

    it("per region: excludes Keluar without region and adjustments, in qty and rupiah", () => {
      const ws = sheet(d, "Rekap Gimmick per Region");
      expect(ws.getCell("A1").value).toBe("Periode: Agu 2026 – Sep 2026 • Program: Imlek 2027");

      const qtyTitle = findRow(ws, "Qty (pcs)");
      const qtyRow = ws.getRow(qtyTitle + 2);
      expect(qtyRow.getCell(1).value).toBe("GMK-0001");
      expect(qtyRow.getCell(4).value).toBe("Jawa Barat");
      expect(qtyRow.getCell(5).value).toBe(10);
      expect(qtyRow.getCell(6).value).toBe(30);
      expect(qtyRow.getCell(7).value).toBe(40);
      const qtyTotal = ws.getRow(findRow(ws, "Total", qtyTitle));
      expect(qtyTotal.getCell(7).value).toBe(40);

      const valueTitle = findRow(ws, "Nilai (Rp)");
      const valueRow = ws.getRow(valueTitle + 2);
      expect(valueRow.getCell(5).value).toBe(250_000);
      expect(valueRow.getCell(6).value).toBe(600_000);
      expect(valueRow.getCell(5).numFmt).toContain("Rp");
      expect(ws.getRow(findRow(ws, "Total", valueTitle)).getCell(7).value).toBe(850_000);
    });

    it("per destination: includes Keluar without region", () => {
      const ws = sheet(d, "Rekap Gimmick per Tujuan");
      const qtyTitle = findRow(ws, "Qty (pcs)");
      expect(ws.getRow(qtyTitle + 2).getCell(1).value).toBe("Region/Distributor");
      expect(ws.getRow(qtyTitle + 3).getCell(1).value).toBe("Internal");
      expect(ws.getRow(qtyTitle + 3).getCell(3).value).toBe(5);
      expect(ws.getRow(findRow(ws, "Total", qtyTitle)).getCell(4).value).toBe(45);

      const valueTitle = findRow(ws, "Nilai (Rp)");
      expect(ws.getRow(findRow(ws, "Total", valueTitle)).getCell(4).value).toBe(975_000);
    });

    it("per program: groups items without program as Tanpa Program", () => {
      const ws = sheet(d, "Rekap Gimmick per Program");
      const qtyTitle = findRow(ws, "Qty (pcs)");
      expect(ws.getRow(qtyTitle + 2).getCell(1).value).toBe("Imlek 2027");
      expect(ws.getRow(qtyTitle + 2).getCell(4).value).toBe(40);
      expect(ws.getRow(qtyTitle + 3).getCell(1).value).toBe("Tanpa Program");

      const valueTitle = findRow(ws, "Nilai (Rp)");
      expect(ws.getRow(valueTitle + 3).getCell(4).value).toBe(125_000);
    });
  });
});

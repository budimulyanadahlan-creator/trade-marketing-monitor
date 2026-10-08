import { describe, it, expect } from "vitest";
import { buildPosmWorkbook, type PosmExportData } from "./posm-excel";

function data(overrides: Partial<PosmExportData> = {}): PosmExportData {
  return {
    balances: [],
    movements: [],
    movementFilterLabel: "Semua mutasi",
    rekap: { months: ["2026-08", "2026-09"], rows: [], monthTotals: [0, 0], grandTotal: 0 },
    assets: [],
    assetStock: { groups: [], total: { total: 0, warehouse: 0, placed: 0, damaged: 0, lost: 0, value: 0 } },
    ...overrides,
  };
}

function sheet(d: PosmExportData, name: string) {
  const ws = buildPosmWorkbook(d).getWorksheet(name);
  if (!ws) throw new Error(`sheet ${name} tidak ada`);
  return ws;
}

describe("buildPosmWorkbook — sheet Saldo POSM", () => {
  it("menulis saldo, stok minimum, dan status stok per item", () => {
    const ws = sheet(
      data({
        balances: [
          {
            code: "POSM-0001",
            name: "Poster Promo",
            brand_name: "Brand X",
            category: "Poster",
            unit: "lembar",
            balance: 5,
            min_stock: 10,
            stock_status: "menipis",
            is_active: true,
            last_movement_date: "2026-09-01",
          },
        ],
      }),
      "Saldo POSM"
    );

    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Kode");
    expect(header.font?.bold).toBe(true);

    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe("POSM-0001");
    expect(row.getCell(2).value).toBe("Poster Promo");
    expect(row.getCell(3).value).toBe("Brand X");
    expect(row.getCell(6).value).toBe(5);
    expect(row.getCell(7).value).toBe(10);
    expect(row.getCell(8).value).toBe("Menipis");
    expect(row.getCell(9).value).toBe("Aktif");
    expect(row.getCell(10).value).toEqual(new Date(Date.UTC(2026, 8, 1)));
  });
});

describe("buildPosmWorkbook — sheet Mutasi", () => {
  it("menulis keterangan filter lalu mutasi dengan qty bertanda, tujuan, dan nomor SKP", () => {
    const ws = sheet(
      data({
        movementFilterLabel: "Tipe: Keluar",
        movements: [
          {
            movement_date: "2026-09-10",
            item_code: "POSM-0001",
            item_name: "Poster Promo",
            unit: "lembar",
            type: "out",
            quantity: -20,
            region_name: "Jawa Barat",
            distributor_name: "PT Distri",
            campaign_skp: "SKP-0007",
            campaign_name: "Promo Agustus",
            notes: "kirim",
            created_by_name: "Budi",
          },
        ],
      }),
      "Mutasi"
    );

    expect(ws.getCell("A1").value).toBe("Filter: Tipe: Keluar");
    expect(ws.getRow(3).getCell(1).value).toBe("Tanggal");
    expect(ws.getRow(3).font?.bold).toBe(true);

    const row = ws.getRow(4);
    expect(row.getCell(1).value).toEqual(new Date(Date.UTC(2026, 8, 10)));
    expect(row.getCell(2).value).toBe("POSM-0001");
    expect(row.getCell(4).value).toBe("Keluar");
    expect(row.getCell(5).value).toBe(-20);
    expect(row.getCell(7).value).toBe("Jawa Barat");
    expect(row.getCell(8).value).toBe("PT Distri");
    expect(row.getCell(9).value).toBe("SKP-0007");
    expect(row.getCell(12).value).toBe("Budi");
  });
});

describe("buildPosmWorkbook — sheet Rekap Keluar", () => {
  it("menulis matriks item × region × bulan dengan total baris dan kolom", () => {
    const ws = sheet(
      data({
        rekap: {
          months: ["2026-08", "2026-09"],
          rows: [
            {
              item_id: "i1",
              item_code: "POSM-0001",
              item_name: "Poster Promo",
              unit: "lembar",
              region_id: "r1",
              region_name: "Jawa Barat",
              months: [0, 20],
              total: 20,
            },
            {
              item_id: "i1",
              item_code: "POSM-0001",
              item_name: "Poster Promo",
              unit: "lembar",
              region_id: "r2",
              region_name: "Jawa Timur",
              months: [5, 3],
              total: 8,
            },
          ],
          monthTotals: [5, 23],
          grandTotal: 28,
        },
      }),
      "Rekap Keluar per Region"
    );

    expect(ws.getCell("A1").value).toBe("Periode: Agu 2026 – Sep 2026");
    const header = ws.getRow(3);
    expect(header.getCell(1).value).toBe("Kode Item");
    expect(header.getCell(5).value).toBe("Agu 2026");
    expect(header.getCell(6).value).toBe("Sep 2026");
    expect(header.getCell(7).value).toBe("Total");

    const first = ws.getRow(4);
    expect(first.getCell(4).value).toBe("Jawa Barat");
    expect(first.getCell(5).value).toBe(0);
    expect(first.getCell(6).value).toBe(20);
    expect(first.getCell(7).value).toBe(20);

    const total = ws.getRow(6);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.font?.bold).toBe(true);
    expect(total.getCell(5).value).toBe(5);
    expect(total.getCell(6).value).toBe(23);
    expect(total.getCell(7).value).toBe(28);
  });
});

describe("buildPosmWorkbook — sheet Daftar Asset", () => {
  it("menulis kondisi, lokasi terkini, dan nilai perolehan dengan total nilai", () => {
    const ws = sheet(
      data({
        assets: [
          {
            code: "AST-0001",
            name: "Cooler Besar",
            asset_type: "Cooler/Chiller",
            brand_name: null,
            serial_number: "SN-1",
            acquisition_date: "2026-01-15",
            acquisition_value: 5_000_000,
            condition: "Baik",
            destination: "placed",
            region_name: "Jawa Barat",
            distributor_name: "PT Distri",
            store_name: "Toko Maju",
            last_event_date: "2026-03-01",
          },
          {
            code: "AST-0002",
            name: "Rak",
            asset_type: "Rak Display",
            brand_name: "Brand X",
            serial_number: null,
            acquisition_date: "2026-02-01",
            acquisition_value: 1_500_000,
            condition: "Rusak Ringan",
            destination: "warehouse",
            region_name: null,
            distributor_name: null,
            store_name: null,
            last_event_date: "2026-02-01",
          },
        ],
      }),
      "Daftar Asset"
    );

    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Kode");
    expect(header.getCell(7).value).toBe("Nilai Perolehan (Rp)");

    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe("AST-0001");
    expect(row.getCell(6).value).toEqual(new Date(Date.UTC(2026, 0, 15)));
    expect(row.getCell(7).value).toBe(5_000_000);
    expect(row.getCell(8).value).toBe("Baik");
    expect(row.getCell(9).value).toBe("Ditempatkan");
    expect(row.getCell(10).value).toBe("Jawa Barat");
    expect(row.getCell(12).value).toBe("Toko Maju");
    expect(ws.getRow(3).getCell(9).value).toBe("Gudang Pusat");

    const total = ws.getRow(4);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.getCell(7).value).toBe(6_500_000);
  });
});

describe("buildPosmWorkbook — sheet Ringkasan Stok Asset", () => {
  const counts = (total: number, warehouse: number, damaged: number, lost: number, value: number) => ({
    total,
    warehouse,
    placed: total - warehouse,
    damaged,
    lost,
    value,
  });

  it("menulis subtotal per Jenis, baris Nama di bawahnya, lalu grand total", () => {
    const ws = sheet(
      data({
        assetStock: {
          groups: [
            {
              typeId: "t-1",
              typeName: "Seragam/Pakaian",
              counts: counts(3, 1, 1, 0, 300_000),
              names: [
                { name: "T-Shirt SPG Hitam", counts: counts(2, 1, 1, 0, 200_000) },
                { name: "T-Shirt SPG Kuning", counts: counts(1, 0, 0, 0, 100_000) },
              ],
            },
            {
              typeId: "t-2",
              typeName: "Tenda/Booth",
              counts: counts(1, 0, 0, 1, 2_000_000),
              names: [{ name: "Tenda 3x3", counts: counts(1, 0, 0, 1, 2_000_000) }],
            },
          ],
          total: counts(4, 1, 1, 1, 2_300_000),
        },
      }),
      "Ringkasan Stok Asset"
    );

    const values = (n: number) => (ws.getRow(n).values as unknown[]).slice(1);
    expect(values(1)).toEqual([
      "Jenis",
      "Nama",
      "Total",
      "Di Gudang Pusat",
      "Ditempatkan",
      "Rusak",
      "Hilang",
      "Nilai Perolehan (Rp)",
    ]);

    expect(values(2)).toEqual(["Seragam/Pakaian", "Subtotal", 3, 1, 2, 1, 0, 300_000]);
    expect(ws.getRow(2).font?.bold).toBe(true);
    expect(ws.getRow(2).getCell(1).fill).toBeDefined();

    expect(values(3)).toEqual(["Seragam/Pakaian", "T-Shirt SPG Hitam", 2, 1, 1, 1, 0, 200_000]);
    expect(ws.getRow(3).font?.bold).toBeFalsy();
    expect(ws.getRow(3).getCell(1).fill).toBeUndefined();
    expect(ws.getRow(4).getCell(2).value).toBe("T-Shirt SPG Kuning");
    expect(values(5).slice(0, 2)).toEqual(["Tenda/Booth", "Subtotal"]);
    expect(ws.getRow(6).getCell(2).value).toBe("Tenda 3x3");

    const total = ws.getRow(7);
    expect(total.getCell(1).value).toBe("Total");
    expect([3, 4, 5, 6, 7, 8].map((c) => total.getCell(c).value)).toEqual([4, 1, 3, 1, 1, 2_300_000]);
    expect(total.font?.bold).toBe(true);
  });

  it("ditulis setelah sheet Daftar Asset", () => {
    const names = buildPosmWorkbook(data()).worksheets.map((ws) => ws.name);
    expect(names.slice(-2)).toEqual(["Daftar Asset", "Ringkasan Stok Asset"]);
  });
});

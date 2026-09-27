import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers — sama pola dengan export/monitoring-budget/route.test.ts
// -------------------------------------------------------

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "lt", "is", "order", "range"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data, error: null });
  return chain;
}

const REGION_ID = "33333333-3333-3333-3333-333333333333";

const TABLES = {
  posm_items: [
    {
      id: "item-1",
      code: "POSM-0001",
      name: "Poster Promo",
      category: "Poster",
      unit: "lembar",
      min_stock: 50,
      is_active: true,
      brand: { name: "Brand X" },
    },
  ],
  posm_stock_balances: [{ item_id: "item-1", balance: 30, last_movement_date: "2026-09-10" }],
  posm_movements: [
    {
      id: "mv-1",
      item_id: "item-1",
      region_id: REGION_ID,
      movement_date: "2026-09-10",
      type: "out",
      quantity: -20,
      notes: null,
      campaign_id: "camp-1",
      item: { code: "POSM-0001", name: "Poster Promo", unit: "lembar" },
      region: { name: "Jawa Barat" },
      distributor: null,
      creator: { full_name: "Budi" },
    },
  ],
  regions: [{ id: REGION_ID, name: "Jawa Barat" }],
  distributors: [],
  marketing_assets: [
    {
      id: "ast-1",
      code: "AST-0001",
      name: "Cooler",
      asset_type: "Cooler/Chiller",
      serial_number: null,
      acquisition_date: "2026-01-15",
      acquisition_value: "5000000",
      brand: null,
    },
  ],
  asset_current_status: [
    {
      asset_id: "ast-1",
      event_date: "2026-02-01",
      destination: "placed",
      region_id: REGION_ID,
      distributor_id: null,
      store_name: "Toko Maju",
      condition: "Baik",
    },
  ],
};

function setupMocks({ user = true, role }: { user?: boolean; role: string | null }) {
  const profileChain = makeChain(role ? { role } : null);

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: "user-1" } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return profileChain;
      if (table in TABLES) return makeChain(TABLES[table as keyof typeof TABLES]);
      return makeChain([]);
    }),
    rpc: vi.fn().mockResolvedValue({ data: [{ id: "camp-1", skp_number: "SKP-0007", name: "Promo" }] }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
}

async function readWorkbook(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

const URL_WITH_FILTERS = `http://localhost/api/export/monitoring-posm?type=out&region=${REGION_ID}&rekap_from=2026-08&rekap_to=2026-09`;

describe("GET /api/export/monitoring-posm — otorisasi", () => {
  it("menolak request tanpa login", async () => {
    setupMocks({ user: false, role: null });
    const res = await GET(new NextRequest(URL_WITH_FILTERS));
    expect(res.status).toBe(401);
  });

  it("menolak distributor", async () => {
    setupMocks({ role: "distributor" });
    const res = await GET(new NextRequest(URL_WITH_FILTERS));
    expect(res.status).toBe(403);
  });

  it.each(["user", "manager", "finance", "admin", "superadmin"])("mengizinkan role %s", async (role) => {
    setupMocks({ role });
    const res = await GET(new NextRequest(URL_WITH_FILTERS));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/export/monitoring-posm — isi file", () => {
  it("menghasilkan workbook 4 sheet dengan angka dari data", async () => {
    setupMocks({ role: "finance" });
    const res = await GET(new NextRequest(URL_WITH_FILTERS));
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toMatch(/monitoring-posm-.*\.xlsx/);

    const wb = await readWorkbook(res);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      "Saldo POSM",
      "Mutasi",
      "Rekap Keluar per Region",
      "Daftar Asset",
    ]);

    const saldo = wb.getWorksheet("Saldo POSM")!.getRow(2);
    expect(saldo.getCell(1).value).toBe("POSM-0001");
    expect(saldo.getCell(6).value).toBe(30);
    expect(saldo.getCell(8).value).toBe("Menipis");

    const mutasi = wb.getWorksheet("Mutasi")!;
    expect(mutasi.getCell("A1").value).toBe("Filter: Tipe: Keluar • Region: Jawa Barat");
    expect(mutasi.getRow(4).getCell(5).value).toBe(-20);
    expect(mutasi.getRow(4).getCell(9).value).toBe("SKP-0007");

    const rekap = wb.getWorksheet("Rekap Keluar per Region")!;
    expect(rekap.getCell("A1").value).toBe("Periode: Agu 2026 – Sep 2026");
    expect(rekap.getRow(4).getCell(6).value).toBe(20); // Sep 2026
    expect(rekap.getRow(5).getCell(7).value).toBe(20); // grand total

    const asset = wb.getWorksheet("Daftar Asset")!.getRow(2);
    expect(asset.getCell(7).value).toBe(5_000_000);
    expect(asset.getCell(9).value).toBe("Ditempatkan");
    expect(asset.getCell(10).value).toBe("Jawa Barat");
  });
});

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers — sama pola dengan app/api/export/excel/route.test.ts
// -------------------------------------------------------

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lt", "is"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data, error: null });
  return chain;
}

const CATEGORIES = [{ id: "tp1", name: "Display", type: "TP", account_code: "TP1" }];
const BUDGETS = [{ promotion_category_id: "tp1", total_amount: 1_000_000 }];
const CAMPAIGNS = [
  {
    id: "camp-1",
    skp_number: "SKP-0001",
    name: "Promo A",
    requested_budget: 300_000,
    status: "approved",
    start_date: "2026-07-15",
    promotion_category_id: "tp1",
    brand: { name: "Brand X" },
  },
];

function setupMocks({
  role,
  tables = {},
}: {
  role: string | null;
  tables?: Record<string, unknown>;
}) {
  const profileChain = makeChain(role ? { role } : null);

  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return profileChain;
      if (table in tables) return makeChain(tables[table]);
      return makeChain([]);
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
}

async function readWorkbook(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}

describe("GET /api/export/monitoring-budget — otorisasi", () => {
  it("menolak request tanpa role admin/superadmin", async () => {
    setupMocks({ role: "finance" });
    const req = new NextRequest("http://localhost/api/export/monitoring-budget?fy=2026&q=2&mode=komitmen");
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("mengizinkan role admin", async () => {
    setupMocks({
      role: "admin",
      tables: {
        promotion_categories: CATEGORIES,
        master_budgets: BUDGETS,
        campaigns: CAMPAIGNS,
      },
    });
    const req = new NextRequest("http://localhost/api/export/monitoring-budget?fy=2026&q=2&mode=komitmen");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/export/monitoring-budget — isi file", () => {
  it("menghasilkan .xlsx dengan angka sesuai agregasi mode komitmen", async () => {
    setupMocks({
      role: "superadmin",
      tables: {
        promotion_categories: CATEGORIES,
        master_budgets: BUDGETS,
        campaigns: CAMPAIGNS,
      },
    });
    const req = new NextRequest("http://localhost/api/export/monitoring-budget?fy=2026&q=2&mode=komitmen");
    const res = await GET(req);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");

    const wb = await readWorkbook(res);
    const ws = wb.worksheets[0];
    expect(String(ws.getCell("A1").value)).toBe("Monitoring Budget Q2 2026");

    // Baris kategori TP1: budget 1.000.000, Juli 2026 (bulan pertama Q2) = 300.000
    const catRow = ws.getRow(5);
    expect(String(catRow.getCell(1).value)).toContain("Display");
    expect(catRow.getCell(2).value).toBe(1_000_000);
    expect(catRow.getCell(3).value).toBe(300_000);
  });
});

import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers — sama pola dengan export/monitoring-posm/route.test.ts
// -------------------------------------------------------

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "gte", "lte", "lt", "is", "ilike", "order", "range"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data, error: null });
  return chain;
}

const REGION_JABAR = "33333333-3333-3333-3333-333333333333";
const REGION_JATIM = "44444444-4444-4444-4444-444444444444";
const DIST_ID = "55555555-5555-5555-5555-555555555555";

function eventRow(overrides: Record<string, unknown>) {
  return {
    id: "evt-1",
    name: "Senam Pagi",
    event_type: "Senam/Olahraga",
    start_date: "2026-08-10",
    end_date: "2026-08-10",
    region_id: REGION_JABAR,
    distributor_id: null,
    location: "Gasibu",
    pic_name: "Andi",
    target_participants: 500,
    target_sales: "10000000",
    status: "terlaksana",
    actual_participants: 620,
    actual_sales: "12500000",
    cancel_reason: null,
    notes: null,
    region: { name: "Jawa Barat" },
    distributor: null,
    brands: [{ deleted_at: null, brand: { name: "Wangzai" } }],
    campaigns: [{ campaign_id: "camp-1", skp_number: "SKP-OLD", deleted_at: null, created_at: "2026-08-01" }],
    photos: [],
    samplings: [
      {
        product_name: "Susu 125ml",
        quantity: 300,
        unit: "pcs",
        sort_order: 0,
        created_at: "2026-08-10",
        deleted_at: null,
        cost: { value: "900000" },
      },
    ],
    costs: {
      planned_budget: "5000000",
      planned_sample_budget: "1000000",
      actual_budget: "4750000",
      vendor: { name: "EO Kreatif" },
    },
    ...overrides,
  };
}

const EVENTS = [
  eventRow({}),
  // Region lain tetapi menautkan distributor akun distributor.
  eventRow({ id: "evt-2", name: "Bazaar Surabaya", region_id: REGION_JATIM, distributor_id: DIST_ID, region: { name: "Jawa Timur" } }),
  // Region lain tanpa tautan: tidak boleh masuk file distributor walau lolos query.
  eventRow({ id: "evt-3", name: "Run Malang", region_id: REGION_JATIM, region: { name: "Jawa Timur" } }),
];

let mockClient: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn>; [key: string]: unknown };
let eventsChain: ReturnType<typeof makeChain>;

function setupMocks({ user = true, role }: { user?: boolean; role: string | null }) {
  const profileChain = makeChain(
    role ? { role, region_id: REGION_JABAR, distributor_id: role === "distributor" ? DIST_ID : null } : null
  );
  eventsChain = makeChain(EVENTS);

  mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: user ? { id: "user-1" } : null } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return profileChain;
      if (table === "events") return eventsChain;
      if (table === "regions") return makeChain([{ id: REGION_JABAR, name: "Jawa Barat" }]);
      return makeChain([]);
    }),
    rpc: vi.fn().mockResolvedValue({
      data: [{ id: "camp-1", skp_number: "SKP-0007", name: "Promo", status: "approved", distributor_id: null }],
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

function headerRow(ws: ExcelJS.Worksheet): unknown[] {
  const values: unknown[] = [];
  ws.getRow(3).eachCell((c) => values.push(c.value));
  return values;
}

function columnValues(ws: ExcelJS.Worksheet, header: string): unknown[] {
  const col = headerRow(ws).indexOf(header) + 1;
  const values: unknown[] = [];
  for (let r = 4; r <= ws.rowCount; r++) values.push(ws.getRow(r).getCell(col).value);
  return values;
}

const URL = `http://localhost/api/export/monitoring-event?fy=2026&q=2&region=${REGION_JABAR}&status=terlaksana`;

describe("GET /api/export/monitoring-event — otorisasi", () => {
  it("menolak request tanpa login", async () => {
    setupMocks({ user: false, role: null });
    const res = await GET(new NextRequest(URL));
    expect(res.status).toBe(401);
  });

  it("menolak user tanpa profil", async () => {
    setupMocks({ role: null });
    const res = await GET(new NextRequest(URL));
    expect(res.status).toBe(403);
  });

  it.each(["user", "manager", "finance", "admin", "superadmin", "distributor"])("mengizinkan role %s", async (role) => {
    setupMocks({ role });
    const res = await GET(new NextRequest(URL));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="monitoring-event-fy2026-q2.xlsx"');
  });
});

describe("GET /api/export/monitoring-event — kuartal & filter", () => {
  it("memfilter query events sesuai kuartal dan filter aktif", async () => {
    setupMocks({ role: "finance" });
    await GET(new NextRequest(URL));
    expect(eventsChain.eq).toHaveBeenCalledWith("fiscal_year", 2026);
    expect(eventsChain.eq).toHaveBeenCalledWith("quarter", 2);
    expect(eventsChain.eq).toHaveBeenCalledWith("region_id", REGION_JABAR);
    expect(eventsChain.eq).toHaveBeenCalledWith("status", "terlaksana");
    expect(eventsChain.is).toHaveBeenCalledWith("deleted_at", null);
  });
});

describe("GET /api/export/monitoring-event — isi file", () => {
  it("internal: semua event, kolom biaya, vendor, dan nilai sampling", async () => {
    setupMocks({ role: "finance" });
    const wb = await readWorkbook(await GET(new NextRequest(URL)));

    const ws = wb.getWorksheet("Event")!;
    expect(ws.getCell("A1").value).toBe(
      "Monitoring Event FY 2026 Q2 • Filter: Region: Jawa Barat • Status: Terlaksana"
    );
    expect(columnValues(ws, "Nama Event")).toEqual(["Senam Pagi", "Bazaar Surabaya", "Run Malang"]);
    expect(columnValues(ws, "No. SKP")[0]).toBe("SKP-0007");
    expect(columnValues(ws, "Badge")[0]).toBe("Belum ada foto");
    expect(columnValues(ws, "Rencana Budget Event (Rp)")[0]).toBe(5_000_000);
    expect(columnValues(ws, "Realisasi Budget Event (Rp)")[0]).toBe(4_750_000);
    expect(columnValues(ws, "Nilai Sampling (Rp)")[0]).toBe(900_000);
    expect(columnValues(ws, "Vendor")[0]).toBe("EO Kreatif");

    const sampling = wb.getWorksheet("Rincian Sampling")!;
    expect(columnValues(sampling, "No Event")).toEqual([1, 2, 3]);
    expect(columnValues(sampling, "Nilai (Rp)")[0]).toBe(900_000);
  });

  it("distributor: hanya event yang boleh dilihat, tanpa biaya/vendor, dan biaya tidak diminta", async () => {
    setupMocks({ role: "distributor" });
    const wb = await readWorkbook(await GET(new NextRequest(URL)));

    const selected = (eventsChain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(selected).not.toContain("event_costs");
    expect(selected).not.toContain("event_sampling_costs");
    expect(selected).not.toContain("vendor");

    const ws = wb.getWorksheet("Event")!;
    expect(columnValues(ws, "Nama Event")).toEqual(["Senam Pagi", "Bazaar Surabaya"]);
    for (const h of ["Rencana Budget Event (Rp)", "Realisasi Budget Event (Rp)", "Vendor", "Nilai Sampling (Rp)"]) {
      expect(headerRow(ws)).not.toContain(h);
    }

    const sampling = wb.getWorksheet("Rincian Sampling")!;
    expect(headerRow(sampling)).not.toContain("Nilai (Rp)");
    expect(columnValues(sampling, "Qty")).toEqual([300, 300]);
  });
});

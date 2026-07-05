import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "eq", "in", "gte", "lte"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data, error: null });
  return chain;
}

function setupMocks(campaigns: unknown[]) {
  const profileChain = makeChain({
    role: "admin",
    department_id: null,
    region_id: null,
    is_active: true,
  });
  const campaignsChain = makeChain(campaigns);

  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return profileChain;
      if (table === "campaigns") return campaignsChain;
      return makeChain([]);
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
}

function baseCampaign(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "camp-1",
    name: "SKP Test",
    status: "approved",
    skp_number: "SKP-0001",
    aa_reference_number: null,
    requested_budget: 0,
    actual_spent: 0,
    sales_projection: 0,
    mechanism: "-",
    objective: null,
    store_id: null,
    start_date: null,
    end_date: null,
    submitted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    department: null,
    brand: null,
    region: null,
    channel: null,
    promotion_category: null,
    action_approval: null,
    vendor: null,
    realizations: [],
    ...overrides,
  };
}

async function extractRows(campaigns: unknown[]) {
  setupMocks(campaigns);
  const req = new NextRequest("http://localhost/api/export/excel");
  const res = await GET(req);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
}

describe("GET /api/export/excel — Cost Ratio", () => {
  it("leaves Cost Ratio blank when requested_budget is 0, even if sales_projection is set", async () => {
    const rows = await extractRows([
      baseCampaign({ requested_budget: 0, sales_projection: 1_000_000 }),
    ]);

    expect(rows[0]["Cost Ratio (%)"]).toBe("");
  });

  it("leaves Cost Ratio blank when sales_projection is 0, even if requested_budget is set", async () => {
    const rows = await extractRows([
      baseCampaign({ requested_budget: 500_000, sales_projection: 0 }),
    ]);

    expect(rows[0]["Cost Ratio (%)"]).toBe("");
  });

  it("computes Cost Ratio when both requested_budget and sales_projection are set", async () => {
    const rows = await extractRows([
      baseCampaign({ requested_budget: 500_000, sales_projection: 1_000_000 }),
    ]);

    expect(rows[0]["Cost Ratio (%)"]).toBe(50);
  });
});

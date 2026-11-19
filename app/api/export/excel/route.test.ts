import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { GET } from "./route";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "eq", "in", "is", "gte", "lte", "or"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data });
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data, error: null });
  return chain;
}

function setupMocks(campaigns: unknown[], role: string = "admin") {
  const profileChain = makeChain({
    role,
    department_id: null,
    region_id: null,
    is_active: true,
  });
  const campaignsChain = makeChain(campaigns);
  const departmentsChain = makeChain([]);

  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return profileChain;
      if (table === "campaigns") return campaignsChain;
      if (table === "departments") return departmentsChain;
      return makeChain([]);
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  return { campaignsChain };
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
    distributor: null,
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

describe("GET /api/export/excel — Distributor", () => {
  it("fills the Distributor column after Vendor when a distributor is set", async () => {
    const rows = await extractRows([
      baseCampaign({
        vendor: { name: "Vendor A" },
        distributor: { name: "Distributor B" },
      }),
    ]);

    expect(rows[0]["Vendor"]).toBe("Vendor A");
    expect(rows[0]["Distributor"]).toBe("Distributor B");
    expect(Object.keys(rows[0]).indexOf("Distributor")).toBe(
      Object.keys(rows[0]).indexOf("Vendor") + 1
    );
  });

  it("leaves Distributor blank when not set", async () => {
    const rows = await extractRows([baseCampaign()]);

    expect(rows[0]["Distributor"]).toBe("");
  });
});

describe("GET /api/export/excel — search (q)", () => {
  it("applies an ilike OR filter across skp_number, name, store_id when q is present", async () => {
    const { campaignsChain } = setupMocks([baseCampaign()]);
    const req = new NextRequest("http://localhost/api/export/excel?q=abc");

    await GET(req);

    expect(campaignsChain.or).toHaveBeenCalledWith(
      "skp_number.ilike.%abc%,name.ilike.%abc%,store_id.ilike.%abc%"
    );
  });

  it("does not apply an OR filter when q is empty", async () => {
    const { campaignsChain } = setupMocks([baseCampaign()]);
    const req = new NextRequest("http://localhost/api/export/excel");

    await GET(req);

    expect(campaignsChain.or).not.toHaveBeenCalled();
  });

  it("escapes PostgREST reserved characters in q", async () => {
    const { campaignsChain } = setupMocks([baseCampaign()]);
    const req = new NextRequest(
      "http://localhost/api/export/excel?q=" + encodeURIComponent("a,b.c(d)")
    );

    await GET(req);

    expect(campaignsChain.or).toHaveBeenCalledWith(
      "skp_number.ilike.%a\\,b\\.c\\(d\\)%,name.ilike.%a\\,b\\.c\\(d\\)%,store_id.ilike.%a\\,b\\.c\\(d\\)%"
    );
  });

  it("applies the same q filter for the distributor role", async () => {
    const { campaignsChain } = setupMocks([baseCampaign()], "distributor");
    const req = new NextRequest("http://localhost/api/export/excel?q=abc");

    await GET(req);

    expect(campaignsChain.or).toHaveBeenCalledWith(
      "skp_number.ilike.%abc%,name.ilike.%abc%,store_id.ilike.%abc%"
    );
  });
});

// SKP Nasional Fase 6: satu SKP induk Rp10 jt + SKP biasa di hasil utama, dan
// dua klaim turunan induk itu (diambil terpisah).
describe("GET /api/export/excel — SKP nasional", () => {
  const parent = baseCampaign({
    id: "p1",
    name: "O Pao Extra",
    skp_number: "0049/WWI/11/2026",
    reference_number: "005/NSM/WWI/XI",
    is_national: true,
    parent_campaign_id: null,
    requested_budget: 10_000_000,
    actual_spent: 3_500_000,
    region: { name: "National" },
  });
  const regular = baseCampaign({ id: "r1", requested_budget: 2_000_000, actual_spent: 500_000 });
  const children = [
    {
      id: "k2",
      parent_campaign_id: "p1",
      skp_number: "0049/WWI/11/2026-K02",
      child_seq: 2,
      status: "paid",
      claim_amount: 2_400_000,
      actual_spent: 2_500_000,
      claim_owner_id: "u2",
      distributor: { name: "Bintang Indo Raya" },
      region: { name: "East Java & Bali" },
      realizations: [
        { invoice_number: "INV-B", amount: 2_000_000, realization_date: "2026-11-02" },
        { invoice_number: "INV-C", amount: 500_000, realization_date: "2026-11-09" },
      ],
    },
    {
      id: "k1",
      parent_campaign_id: "p1",
      skp_number: "0049/WWI/11/2026-K01",
      child_seq: 1,
      status: "ongoing",
      claim_amount: null,
      actual_spent: 1_000_000,
      claim_owner_id: "u1",
      distributor: { name: "Esham Dima" },
      region: { name: "West & Central Java" },
      realizations: [{ invoice_number: "INV-A", amount: 1_000_000, realization_date: "2026-10-20" }],
    },
  ];
  const owners = [
    { id: "u1", full_name: "Cabang Bandung" },
    { id: "u2", full_name: "Cabang Surabaya" },
  ];

  async function exportWorkbook(role: string) {
    const profileChain = makeChain({ role, department_id: null, region_id: null, is_active: true });
    // `users` dipakai dua kali: profil (.single) dan nama pemilik klaim (await).
    profileChain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: owners, error: null });
    const mainChain = makeChain([parent, regular]);
    const childChain = makeChain(children);

    // Klien pengguna: panggilan pertama ke campaigns = daftar utama, berikutnya = turunan (RLS).
    let userCampaignCalls = 0;
    const userClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") return profileChain;
        if (table === "campaigns") return userCampaignCalls++ === 0 ? mainChain : childChain;
        return makeChain([]);
      }),
    };
    const adminClient = { from: vi.fn().mockReturnValue(childChain) };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(userClient);
    (createAdminClient as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(adminClient);

    const res = await GET(new NextRequest("http://localhost/api/export/excel"));
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const sheet = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]);
    return { wb, sheet, mainChain, childChain, adminClient };
  }

  it("role internal: induk satu baris dengan realisasi gabungan, tanpa baris turunan", async () => {
    const { wb, sheet, mainChain, childChain, adminClient } = await exportWorkbook("admin");

    expect(mainChain.is).toHaveBeenCalledWith("parent_campaign_id", null);
    expect(adminClient.from).toHaveBeenCalledWith("campaigns");
    expect(childChain.in).toHaveBeenCalledWith("parent_campaign_id", ["p1"]);

    expect(wb.SheetNames).toEqual(["Rekap SKP", "Klaim Nasional"]);
    const rows = sheet("Rekap SKP");
    expect(rows).toHaveLength(2);
    expect(rows[0]["Budget (IDR)"]).toBe(10_000_000);
    expect(rows[0]["Realisasi (IDR)"]).toBe(3_500_000);
    expect(rows[0]["Jml Invoice"]).toBe(3);
    expect(rows[0]["No. Invoice"]).toBe("INV-B, INV-C, INV-A");
    // total tidak berubah akibat adanya turunan
    expect(rows.reduce((s, r) => s + (r["Budget (IDR)"] as number), 0)).toBe(12_000_000);
    expect(rows.reduce((s, r) => s + (r["Realisasi (IDR)"] as number), 0)).toBe(4_000_000);
  });

  it("lembar Klaim Nasional memuat satu baris per turunan, urut nomor klaim", async () => {
    const { sheet } = await exportWorkbook("finance");
    const rows = sheet("Klaim Nasional");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      "SKP Induk": "O Pao Extra",
      "No. SKP Induk": "0049/WWI/11/2026",
      "No. Surat": "005/NSM/WWI/XI",
      Perusahaan: "Esham Dima",
      Akun: "Cabang Bandung",
      Region: "West & Central Java",
      "No. Klaim": "0049/WWI/11/2026-K01",
      "Realisasi (IDR)": 1_000_000,
      Status: "Berjalan",
    });
    expect(rows[1]).toMatchObject({
      Akun: "Cabang Surabaya",
      "No. Klaim": "0049/WWI/11/2026-K02",
      "Nominal Klaim (IDR)": 2_400_000,
      "Realisasi (IDR)": 2_500_000,
      Status: "Paid",
    });
    // rincian per turunan berjumlah sama dengan realisasi gabungan induk
    expect(rows.reduce((s, r) => s + (r["Realisasi (IDR)"] as number), 0)).toBe(3_500_000);
  });

  it("distributor: turunan dibaca lewat RLS (bukan hak layanan) dan realisasi gabungan induk disembunyikan", async () => {
    const { sheet, mainChain, adminClient } = await exportWorkbook("distributor");

    expect(adminClient.from).not.toHaveBeenCalled();
    expect(mainChain.is).not.toHaveBeenCalled();
    const rows = sheet("Rekap SKP Distributor");
    expect(rows[0]["Budget (IDR)"]).toBe(10_000_000);
    expect(rows[0]["Realisasi (IDR)"]).toBe(0);
    expect(rows[0]["Status Penerimaan"]).toBe("Tidak berlaku");
    expect(rows[1]["Realisasi (IDR)"]).toBe(500_000);
    expect(sheet("Klaim Nasional")).toHaveLength(2);
  });

  it("tanpa SKP nasional: lembar Klaim Nasional tetap ada dan kosong", async () => {
    setupMocks([baseCampaign()]);
    const res = await GET(new NextRequest("http://localhost/api/export/excel"));
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });

    expect(wb.SheetNames).toEqual(["Rekap SKP", "Klaim Nasional"]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Klaim Nasional"])).toEqual([]);
    expect(XLSX.utils.sheet_to_json(wb.Sheets["Klaim Nasional"], { header: 1 })[0]).toContain("No. Klaim");
  });
});

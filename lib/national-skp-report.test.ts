import { describe, it, expect } from "vitest";
import {
  withoutNationalChildren,
  hideNationalParentSpend,
  mergeChildRealizations,
  buildNationalClaimSheetRows,
  NATIONAL_CLAIM_SHEET_HEADERS,
} from "./national-skp-report";

// Satu SKP induk nasional Rp10 jt dengan tiga klaim turunan (satu dibatalkan)
// dan satu SKP biasa — bentuk data yang sama dengan yang dibaca laporan.
const PARENT = {
  id: "p1",
  name: "O Pao Extra",
  skp_number: "0049/WWI/11/2026",
  reference_number: "005/NSM/WWI/XI",
  is_national: true,
  parent_campaign_id: null,
  requested_budget: 10_000_000,
  actual_spent: 3_500_000, // dijaga database = jumlah turunan
  realizations: [] as { invoice_number: string; amount: number }[],
};
const REGULAR = {
  id: "r1",
  name: "Display Toko A",
  skp_number: "0001/WWI/11/2026",
  reference_number: null,
  is_national: false,
  parent_campaign_id: null,
  requested_budget: 2_000_000,
  actual_spent: 500_000,
  realizations: [{ invoice_number: "INV-R", amount: 500_000 }],
};
const CHILD_1 = {
  id: "k1",
  name: "O Pao Extra – klaim Cabang Bandung",
  skp_number: "0049/WWI/11/2026-K01",
  reference_number: null,
  is_national: false,
  parent_campaign_id: "p1",
  requested_budget: 0,
  actual_spent: 1_000_000,
  realizations: [{ invoice_number: "INV-A", amount: 1_000_000 }],
};
const CHILD_2 = {
  ...CHILD_1,
  id: "k2",
  skp_number: "0049/WWI/11/2026-K02",
  actual_spent: 2_500_000,
  realizations: [
    { invoice_number: "INV-B", amount: 2_000_000 },
    { invoice_number: "INV-C", amount: 500_000 },
  ],
};
const CHILD_CANCELLED = {
  ...CHILD_1,
  id: "k3",
  skp_number: "0049/WWI/11/2026-K03",
  actual_spent: 0,
  realizations: [],
};

const sum = (rows: { requested_budget: number; actual_spent: number }[]) => ({
  budget: rows.reduce((s, r) => s + r.requested_budget, 0),
  spent: rows.reduce((s, r) => s + r.actual_spent, 0),
});

describe("withoutNationalChildren", () => {
  it("membuang baris klaim turunan dan mempertahankan induk serta SKP biasa", () => {
    const rows = [PARENT, CHILD_1, REGULAR, CHILD_2, CHILD_CANCELLED];
    expect(withoutNationalChildren(rows).map((r) => r.id)).toEqual(["p1", "r1"]);
  });

  it("total nilai dan realisasi sama dengan atau tanpa baris turunan di database", () => {
    const withChildren = withoutNationalChildren([PARENT, CHILD_1, CHILD_2, CHILD_CANCELLED, REGULAR]);
    expect(sum(withChildren)).toEqual({ budget: 12_000_000, spent: 4_000_000 });
    // tanpa penyaring, realisasi turunan terhitung dua kali
    expect(sum([PARENT, CHILD_1, CHILD_2, REGULAR]).spent).toBe(7_500_000);
  });
});

describe("hideNationalParentSpend", () => {
  it("menolkan realisasi gabungan induk untuk distributor tanpa mengubah baris lain", () => {
    const rows = hideNationalParentSpend([PARENT, CHILD_1, REGULAR]);
    expect(rows.map((r) => r.actual_spent)).toEqual([0, 1_000_000, 500_000]);
    expect(rows[0].requested_budget).toBe(10_000_000);
  });

  it("tidak mengubah data asal", () => {
    hideNationalParentSpend([PARENT]);
    expect(PARENT.actual_spent).toBe(3_500_000);
  });
});

describe("mergeChildRealizations", () => {
  it("menggabungkan invoice semua turunan ke baris induknya", () => {
    const [parent, regular] = mergeChildRealizations(
      [PARENT, REGULAR],
      [CHILD_1, CHILD_2, CHILD_CANCELLED]
    );
    expect(parent.realizations.map((r) => r.invoice_number)).toEqual(["INV-A", "INV-B", "INV-C"]);
    expect(regular.realizations.map((r) => r.invoice_number)).toEqual(["INV-R"]);
  });

  it("mengabaikan turunan yang induknya tidak ada di daftar", () => {
    const [regular] = mergeChildRealizations([REGULAR], [CHILD_1]);
    expect(regular.realizations).toHaveLength(1);
  });

  it("tahan terhadap realizations kosong / null", () => {
    const [parent] = mergeChildRealizations(
      [{ ...PARENT, realizations: null }],
      [{ parent_campaign_id: "p1", realizations: null }]
    );
    expect(parent.realizations).toEqual([]);
  });
});

describe("buildNationalClaimSheetRows", () => {
  const label = (s: string) => ({ approved: "Disetujui", paid: "Paid", cancelled: "Dibatalkan" })[s] ?? s;
  const children = [
    {
      parent_campaign_id: "p1",
      skp_number: "0049/WWI/11/2026-K02",
      child_seq: 2,
      status: "paid",
      claim_amount: 2_400_000,
      actual_spent: 2_500_000,
      distributor: { name: "Bintang Indo Raya" },
      region: { name: "East Java & Bali" },
      owner_name: "Cabang Surabaya",
    },
    {
      parent_campaign_id: "p1",
      skp_number: "0049/WWI/11/2026-K01",
      child_seq: 1,
      status: "approved",
      claim_amount: null,
      actual_spent: 0,
      distributor: { name: "Esham Dima" },
      region: { name: "West & Central Java" },
      owner_name: "Cabang Bandung",
    },
  ];

  it("satu baris per turunan, urut per induk lalu nomor urut, dengan kolom rincian", () => {
    const rows = buildNationalClaimSheetRows(children, [PARENT], label);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])).toEqual([...NATIONAL_CLAIM_SHEET_HEADERS]);
    expect(rows[0]).toEqual({
      "SKP Induk": "O Pao Extra",
      "No. SKP Induk": "0049/WWI/11/2026",
      "No. Surat": "005/NSM/WWI/XI",
      Perusahaan: "Esham Dima",
      Akun: "Cabang Bandung",
      Region: "West & Central Java",
      "No. Klaim": "0049/WWI/11/2026-K01",
      "Nominal Klaim (IDR)": "",
      "Realisasi (IDR)": 0,
      Status: "Disetujui",
    });
    expect(rows[1]["Nominal Klaim (IDR)"]).toBe(2_400_000);
    expect(rows[1]["Realisasi (IDR)"]).toBe(2_500_000);
    expect(rows[1].Status).toBe("Paid");
  });

  it("jumlah realisasi lembar rincian sama dengan realisasi gabungan induk", () => {
    const rows = buildNationalClaimSheetRows(
      [
        { ...children[0], actual_spent: CHILD_2.actual_spent },
        { ...children[1], actual_spent: CHILD_1.actual_spent },
      ],
      [PARENT],
      label
    );
    const total = rows.reduce((s, r) => s + (r["Realisasi (IDR)"] as number), 0);
    expect(total).toBe(PARENT.actual_spent);
  });

  it("melewati turunan yang induknya tidak ada di daftar", () => {
    expect(buildNationalClaimSheetRows(children, [], label)).toEqual([]);
  });
});

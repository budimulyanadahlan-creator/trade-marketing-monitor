import { describe, expect, it } from "vitest";
import {
  COMMITTED_CAMPAIGN_STATUSES,
  computeAARemainingBudget,
  groupCampaignsByCommitment,
  isCommittedStatus,
  sumCommittedBudgetByAA,
} from "./campaign-status";

describe("COMMITTED_CAMPAIGN_STATUSES", () => {
  it("memuat tepat status komitmen (L1 ke atas)", () => {
    expect([...COMMITTED_CAMPAIGN_STATUSES].sort()).toEqual(
      [
        "approved_l1",
        "approved_l2",
        "approved_l3",
        "approved_l4",
        "approved",
        "ongoing",
        "claim_submitted",
        "paid",
        "completed",
      ].sort()
    );
  });

  it("draft, submitted, rejected, cancelled bukan status komitmen", () => {
    for (const status of ["draft", "submitted", "rejected", "cancelled"] as const) {
      expect(isCommittedStatus(status)).toBe(false);
    }
  });
});

describe("sumCommittedBudgetByAA", () => {
  it("hanya menjumlahkan campaign berstatus komitmen per AA", () => {
    const totals = sumCommittedBudgetByAA([
      { action_approval_id: "aa-1", requested_budget: 100, status: "approved_l1" },
      { action_approval_id: "aa-1", requested_budget: 50, status: "paid" },
      { action_approval_id: "aa-1", requested_budget: 999, status: "rejected" },
      { action_approval_id: "aa-1", requested_budget: 40, status: "submitted" },
      { action_approval_id: "aa-2", requested_budget: 70, status: "ongoing" },
      { action_approval_id: null, requested_budget: 30, status: "approved" },
    ]);
    expect(totals).toEqual({ "aa-1": 150, "aa-2": 70 });
  });

  it("AA yang hanya punya campaign non-komitmen tidak muncul (total 0 implisit)", () => {
    const totals = sumCommittedBudgetByAA([
      { action_approval_id: "aa-3", requested_budget: 500, status: "rejected" },
      { action_approval_id: "aa-3", requested_budget: 200, status: "draft" },
      { action_approval_id: "aa-3", requested_budget: 100, status: "cancelled" },
    ]);
    expect(totals["aa-3"]).toBeUndefined();
  });

  it("requested_budget null dianggap 0", () => {
    const totals = sumCommittedBudgetByAA([
      { action_approval_id: "aa-4", requested_budget: null, status: "approved" },
      { action_approval_id: "aa-4", requested_budget: 25, status: "completed" },
    ]);
    expect(totals).toEqual({ "aa-4": 25 });
  });
});

describe("groupCampaignsByCommitment", () => {
  it("memisahkan campaign komitmen dan non-komitmen dengan subtotal masing-masing", () => {
    const campaigns = [
      { id: "c1", requested_budget: 100, status: "approved_l1" as const },
      { id: "c2", requested_budget: 999, status: "rejected" as const },
      { id: "c3", requested_budget: 50, status: "paid" as const },
      { id: "c4", requested_budget: 40, status: "submitted" as const },
    ];
    const result = groupCampaignsByCommitment(campaigns);
    expect(result.committed.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(result.notCommitted.map((c) => c.id)).toEqual(["c2", "c4"]);
    expect(result.committedTotal).toBe(150);
    expect(result.notCommittedTotal).toBe(1039);
  });

  it("daftar kosong menghasilkan dua kelompok kosong dengan subtotal 0", () => {
    const result = groupCampaignsByCommitment([]);
    expect(result.committed).toEqual([]);
    expect(result.notCommitted).toEqual([]);
    expect(result.committedTotal).toBe(0);
    expect(result.notCommittedTotal).toBe(0);
  });

  it("requested_budget null dianggap 0 dalam subtotal", () => {
    const result = groupCampaignsByCommitment([
      { id: "c1", requested_budget: null, status: "approved" as const },
      { id: "c2", requested_budget: null, status: "draft" as const },
    ]);
    expect(result.committedTotal).toBe(0);
    expect(result.notCommittedTotal).toBe(0);
    expect(result.committed).toHaveLength(1);
    expect(result.notCommitted).toHaveLength(1);
  });
});

describe("computeAARemainingBudget", () => {
  it("sisa = target dikurangi total campaign berstatus komitmen saja", () => {
    const remaining = computeAARemainingBudget(1000, [
      { id: "c1", requested_budget: 600, status: "approved_l1" },
      { id: "c2", requested_budget: 100, status: "paid" },
      { id: "c3", requested_budget: 900, status: "rejected" },
      { id: "c4", requested_budget: 900, status: "submitted" },
    ]);
    expect(remaining).toBe(300);
  });

  it("campaign yang sedang direview dikeluarkan dari komitmen jika sudah berstatus komitmen", () => {
    const remaining = computeAARemainingBudget(
      1000,
      [
        { id: "c-self", requested_budget: 800, status: "approved_l2" },
        { id: "c-other", requested_budget: 100, status: "approved" },
      ],
      "c-self"
    );
    expect(remaining).toBe(900);
  });

  it("bisa negatif saat komitmen melebihi target", () => {
    const remaining = computeAARemainingBudget(1000, [
      { id: "c1", requested_budget: 1104509314, status: "approved" },
    ]);
    expect(remaining).toBe(1000 - 1104509314);
  });

  it("tanpa campaign, sisa = target penuh; requested_budget null dianggap 0", () => {
    expect(computeAARemainingBudget(500, [])).toBe(500);
    expect(
      computeAARemainingBudget(500, [
        { id: "c1", requested_budget: null, status: "ongoing" },
      ])
    ).toBe(500);
  });
});

import { describe, expect, it } from "vitest";
import {
  COMMITTED_CAMPAIGN_STATUSES,
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

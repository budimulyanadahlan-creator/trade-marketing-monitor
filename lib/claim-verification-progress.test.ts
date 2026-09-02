import { describe, it, expect } from "vitest";
import { computeClaimVerificationProgressByCampaignId } from "./claim-verification-progress";

describe("computeClaimVerificationProgressByCampaignId", () => {
  it("returns nothing for a campaign with no items (not in the result map)", () => {
    const result = computeClaimVerificationProgressByCampaignId([]);
    expect(result).toEqual({});
  });

  it("counts accepted items out of the total", () => {
    const result = computeClaimVerificationProgressByCampaignId([
      { campaign_id: "c1", status: "accepted" },
      { campaign_id: "c1", status: "accepted" },
      { campaign_id: "c1", status: "pending" },
    ]);

    expect(result.c1).toEqual({ total: 3, accepted: 2, hasRevisionRequested: false });
  });

  it("flags hasRevisionRequested when any item is revision_requested", () => {
    const result = computeClaimVerificationProgressByCampaignId([
      { campaign_id: "c1", status: "accepted" },
      { campaign_id: "c1", status: "revision_requested" },
    ]);

    expect(result.c1).toEqual({ total: 2, accepted: 1, hasRevisionRequested: true });
  });

  it("keeps campaigns independent of each other", () => {
    const result = computeClaimVerificationProgressByCampaignId([
      { campaign_id: "c1", status: "accepted" },
      { campaign_id: "c2", status: "pending" },
      { campaign_id: "c2", status: "revision_requested" },
    ]);

    expect(result.c1).toEqual({ total: 1, accepted: 1, hasRevisionRequested: false });
    expect(result.c2).toEqual({ total: 2, accepted: 0, hasRevisionRequested: true });
  });

  it("treats all-accepted as complete progress", () => {
    const result = computeClaimVerificationProgressByCampaignId([
      { campaign_id: "c1", status: "accepted" },
      { campaign_id: "c1", status: "accepted" },
    ]);

    expect(result.c1).toEqual({ total: 2, accepted: 2, hasRevisionRequested: false });
  });
});

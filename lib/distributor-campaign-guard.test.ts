import { describe, it, expect } from "vitest";
import { isDistributorAllowedOnCampaign } from "./distributor-campaign-guard";

describe("isDistributorAllowedOnCampaign", () => {
  it("allows when the campaign has no distributor company assigned yet", () => {
    expect(isDistributorAllowedOnCampaign(null, null)).toBe(true);
    expect(isDistributorAllowedOnCampaign(null, "company-a")).toBe(true);
  });

  it("allows when the distributor belongs to the campaign's assigned company", () => {
    expect(isDistributorAllowedOnCampaign("company-a", "company-a")).toBe(true);
  });

  it("rejects an unmapped distributor account on an assigned campaign", () => {
    expect(isDistributorAllowedOnCampaign("company-a", null)).toBe(false);
  });

  it("rejects a distributor from a different company", () => {
    expect(isDistributorAllowedOnCampaign("company-a", "company-b")).toBe(false);
  });
});

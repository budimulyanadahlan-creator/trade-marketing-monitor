import { describe, it, expect } from "vitest";
import {
  isDistributorRequiredDepartment,
  distributorRequiredError,
  isCampaignWithoutDistributor,
  DISTRIBUTOR_REQUIRED_MESSAGE,
} from "./campaign-distributor-required";

describe("isDistributorRequiredDepartment", () => {
  it("is true for Sales and Trade Marketing regardless of case", () => {
    expect(isDistributorRequiredDepartment("Sales")).toBe(true);
    expect(isDistributorRequiredDepartment("trade marketing")).toBe(true);
    expect(isDistributorRequiredDepartment("TRADE MARKETING")).toBe(true);
  });

  it("is false for other departments and unknown", () => {
    expect(isDistributorRequiredDepartment("Marketing")).toBe(false);
    expect(isDistributorRequiredDepartment("Finance")).toBe(false);
    expect(isDistributorRequiredDepartment(null)).toBe(false);
    expect(isDistributorRequiredDepartment(undefined)).toBe(false);
  });
});

describe("distributorRequiredError", () => {
  it("returns the message when Sales/TM has no distributor", () => {
    expect(distributorRequiredError("Sales", null)).toBe(DISTRIBUTOR_REQUIRED_MESSAGE);
    expect(distributorRequiredError("Trade Marketing", "")).toBe(DISTRIBUTOR_REQUIRED_MESSAGE);
  });

  it("returns null when distributor is set or department does not require it", () => {
    expect(distributorRequiredError("Sales", "dist-1")).toBeNull();
    expect(distributorRequiredError("Marketing", null)).toBeNull();
  });

  it("explains why the field is required", () => {
    expect(DISTRIBUTOR_REQUIRED_MESSAGE).toContain("tidak akan terlihat oleh distributor");
  });
});

describe("isCampaignWithoutDistributor", () => {
  const base = { distributor_id: null, status: "approved", departmentName: "Sales" };

  it("matches Sales/TM campaigns in the distributor-visible window without a distributor", () => {
    expect(isCampaignWithoutDistributor(base)).toBe(true);
    expect(isCampaignWithoutDistributor({ ...base, status: "completed", departmentName: "Trade Marketing" })).toBe(true);
  });

  it("ignores campaigns with a distributor, other departments, or statuses outside the window", () => {
    expect(isCampaignWithoutDistributor({ ...base, distributor_id: "d-1" })).toBe(false);
    expect(isCampaignWithoutDistributor({ ...base, departmentName: "Marketing" })).toBe(false);
    expect(isCampaignWithoutDistributor({ ...base, status: "draft" })).toBe(false);
    expect(isCampaignWithoutDistributor({ ...base, status: "submitted" })).toBe(false);
    expect(isCampaignWithoutDistributor({ ...base, status: "rejected" })).toBe(false);
  });
});

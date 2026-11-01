import { describe, it, expect } from "vitest";
import {
  DISTRIBUTOR_GUARD_MESSAGES,
  distributorGuardDenial,
  isDistributorAllowedOnCampaign,
  distributorClaimActionError,
} from "./distributor-campaign-guard";

describe("distributorGuardDenial", () => {
  it("allows when the distributor belongs to the campaign's company", () => {
    expect(distributorGuardDenial("company-a", "company-a")).toBeNull();
  });

  it("allows a mapped distributor on a campaign with no company yet (sementara, sampai Fase 6)", () => {
    expect(distributorGuardDenial(null, "company-a")).toBeNull();
  });

  it("rejects a distributor from a different company", () => {
    expect(distributorGuardDenial("company-a", "company-b")).toBe("otherCompany");
  });

  it("rejects an unmapped account on an assigned campaign", () => {
    expect(distributorGuardDenial("company-a", null)).toBe("noCompany");
  });

  it("rejects an unmapped account even on an unassigned campaign", () => {
    expect(distributorGuardDenial(null, null)).toBe("noCompany");
  });
});

describe("isDistributorAllowedOnCampaign", () => {
  it("mirrors distributorGuardDenial as a boolean", () => {
    expect(isDistributorAllowedOnCampaign("company-a", "company-a")).toBe(true);
    expect(isDistributorAllowedOnCampaign(null, "company-a")).toBe(true);
    expect(isDistributorAllowedOnCampaign("company-a", "company-b")).toBe(false);
    expect(isDistributorAllowedOnCampaign("company-a", null)).toBe(false);
    expect(isDistributorAllowedOnCampaign(null, null)).toBe(false);
  });
});

describe("distributorClaimActionError", () => {
  it("rejects a distributor account with no company even on an unassigned campaign", () => {
    expect(distributorClaimActionError("distributor", null, null)).toBe(
      "Akun Anda belum terhubung ke perusahaan distributor"
    );
    expect(distributorClaimActionError("distributor", null, "company-a")).toBe(
      DISTRIBUTOR_GUARD_MESSAGES.noCompany
    );
  });

  it("rejects a distributor from another company with a friendly message", () => {
    expect(distributorClaimActionError("distributor", "company-b", "company-a")).toBe(
      "SKP ini bukan milik distributor Anda"
    );
  });

  it("allows same company and unassigned campaigns for a mapped distributor", () => {
    expect(distributorClaimActionError("distributor", "company-a", "company-a")).toBeNull();
    expect(distributorClaimActionError("distributor", "company-a", null)).toBeNull();
  });

  it("never blocks admin or superadmin, regardless of company mapping", () => {
    expect(distributorClaimActionError("admin", null, "company-a")).toBeNull();
    expect(distributorClaimActionError("superadmin", null, null)).toBeNull();
    expect(distributorClaimActionError("admin", "company-b", "company-a")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { computeChecklistReadinessByCampaignId } from "./claim-checklist-status";

describe("computeChecklistReadinessByCampaignId", () => {
  it("returns required=0 for a campaign with no promotion_category_id", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: null }],
      requirements: [],
      checklists: [],
    });

    expect(result.c1).toEqual({ required: 0, fulfilled: 0 });
  });

  it("returns required=0 when the promotion category has no claim requirements", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: "cat-1" }],
      requirements: [],
      checklists: [],
    });

    expect(result.c1).toEqual({ required: 0, fulfilled: 0 });
  });

  it("counts fulfilled document types distinctly, ignoring unfulfilled rows", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: "cat-1" }],
      requirements: [
        { promotion_category_id: "cat-1", document_type_id: "doc-a" },
        { promotion_category_id: "cat-1", document_type_id: "doc-b" },
        { promotion_category_id: "cat-1", document_type_id: "doc-c" },
      ],
      checklists: [
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
        { campaign_id: "c1", document_type_id: "doc-b", is_fulfilled: false },
      ],
    });

    expect(result.c1).toEqual({ required: 3, fulfilled: 1 });
  });

  it("marks a campaign as complete when fulfilled count reaches required count", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: "cat-1" }],
      requirements: [
        { promotion_category_id: "cat-1", document_type_id: "doc-a" },
        { promotion_category_id: "cat-1", document_type_id: "doc-b" },
      ],
      checklists: [
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
        { campaign_id: "c1", document_type_id: "doc-b", is_fulfilled: true },
      ],
    });

    expect(result.c1).toEqual({ required: 2, fulfilled: 2 });
  });

  it("does not double-count duplicate fulfilled rows for the same document type", () => {
    // Multiple distributor accounts could in theory each have a row for the
    // same campaign_id + document_type_id — should still count as 1.
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: "cat-1" }],
      requirements: [
        { promotion_category_id: "cat-1", document_type_id: "doc-a" },
      ],
      checklists: [
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
      ],
    });

    expect(result.c1).toEqual({ required: 1, fulfilled: 1 });
  });

  it("keeps campaigns independent of each other", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [
        { id: "c1", promotion_category_id: "cat-1" },
        { id: "c2", promotion_category_id: "cat-1" },
      ],
      requirements: [
        { promotion_category_id: "cat-1", document_type_id: "doc-a" },
        { promotion_category_id: "cat-1", document_type_id: "doc-b" },
      ],
      checklists: [
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
        { campaign_id: "c1", document_type_id: "doc-b", is_fulfilled: true },
        { campaign_id: "c2", document_type_id: "doc-a", is_fulfilled: true },
      ],
    });

    expect(result.c1).toEqual({ required: 2, fulfilled: 2 });
    expect(result.c2).toEqual({ required: 2, fulfilled: 1 });
  });

  it("ignores checklist rows for document types outside the campaign's required set", () => {
    const result = computeChecklistReadinessByCampaignId({
      campaigns: [{ id: "c1", promotion_category_id: "cat-1" }],
      requirements: [
        { promotion_category_id: "cat-1", document_type_id: "doc-a" },
      ],
      checklists: [
        { campaign_id: "c1", document_type_id: "doc-a", is_fulfilled: true },
        { campaign_id: "c1", document_type_id: "doc-stale", is_fulfilled: true },
      ],
    });

    expect(result.c1).toEqual({ required: 1, fulfilled: 1 });
  });
});

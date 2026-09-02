import type { ClaimItemStatus } from "@/types/database";

/**
 * Computes, per campaign, how many claim_item_verifications rows are
 * `accepted` out of the total, plus whether any row is stuck at
 * `revision_requested` — the two facts the SKP list's finance-queue badge
 * needs (Phase 5 of verifikasi klaim finance).
 *
 * Pure aggregation, no I/O — the caller batch-fetches claim_item_verifications
 * for every claim_submitted campaign in one query and passes the rows in, so
 * rendering the badge across an entire list never costs a query per row.
 */

export type ClaimVerificationProgress = {
  total: number;
  accepted: number;
  hasRevisionRequested: boolean;
};

export function computeClaimVerificationProgressByCampaignId(
  items: { campaign_id: string; status: ClaimItemStatus }[]
): Record<string, ClaimVerificationProgress> {
  const result: Record<string, ClaimVerificationProgress> = {};

  for (const item of items) {
    const progress = result[item.campaign_id] ?? {
      total: 0,
      accepted: 0,
      hasRevisionRequested: false,
    };
    progress.total += 1;
    if (item.status === "accepted") progress.accepted += 1;
    if (item.status === "revision_requested") progress.hasRevisionRequested = true;
    result[item.campaign_id] = progress;
  }

  return result;
}

/**
 * Whether a distributor-role user is allowed to write claim data (checklist
 * toggles, claim document uploads) on a given campaign. A scoped guard for
 * those two write actions only — not a replacement for the broader
 * distributor visibility gap (any distributor can currently SELECT/browse
 * any campaign; see migration 031/032 and PRD Keputusan #5), which stays a
 * separate, not-yet-filtered concern.
 *
 * Added after a real incident: an unmapped test account ("distributor tes",
 * distributor_id null) checked off a production campaign's claim checklist
 * for a company it had no relation to, so Finance saw "5/5 dokumen siap"
 * while the actual assigned distributor had uploaded 1 of 5.
 *
 * Pure, no I/O — callers fetch campaign.distributor_id and the acting user's
 * users.distributor_id and pass them in.
 */
export function isDistributorAllowedOnCampaign(
  campaignDistributorId: string | null,
  userDistributorId: string | null
): boolean {
  // Campaign not yet assigned to a distributor company (common — the
  // distributor_id backfill from migration 028 is still in progress across
  // existing campaigns). Falls back to the pre-guardrail behavior so those
  // campaigns don't lock out real distributors.
  if (!campaignDistributorId) return true;

  // Campaign IS assigned to a company: the acting distributor must belong
  // to that same company. An unmapped account (distributor_id null) never
  // matches, which is the case that caused the incident above.
  return campaignDistributorId === userDistributorId;
}

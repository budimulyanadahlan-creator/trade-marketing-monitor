/**
 * Computes, per campaign, how many claim-document checklist items are
 * required (from claim_requirements for its promotion category) vs how many
 * are fulfilled (from distributor_claim_checklists) — distinct by
 * document_type_id, mirroring the per-campaign logic already used on the
 * campaign detail page (app/(protected)/campaigns/[id]/page.tsx).
 *
 * Pure aggregation, no I/O — callers batch-fetch the rows and pass them in,
 * so this stays cheap to run over an entire campaigns list without N+1
 * queries.
 */

export type ChecklistReadiness = { required: number; fulfilled: number };

export function computeChecklistReadinessByCampaignId(input: {
  campaigns: { id: string; promotion_category_id: string | null }[];
  requirements: { promotion_category_id: string; document_type_id: string }[];
  checklists: { campaign_id: string; document_type_id: string; is_fulfilled: boolean }[];
}): Record<string, ChecklistReadiness> {
  const requiredDocTypesByCategory = new Map<string, Set<string>>();
  for (const r of input.requirements) {
    const set = requiredDocTypesByCategory.get(r.promotion_category_id) ?? new Set<string>();
    set.add(r.document_type_id);
    requiredDocTypesByCategory.set(r.promotion_category_id, set);
  }

  const fulfilledDocTypesByCampaign = new Map<string, Set<string>>();
  for (const row of input.checklists) {
    if (!row.is_fulfilled) continue;
    const set = fulfilledDocTypesByCampaign.get(row.campaign_id) ?? new Set<string>();
    set.add(row.document_type_id);
    fulfilledDocTypesByCampaign.set(row.campaign_id, set);
  }

  const result: Record<string, ChecklistReadiness> = {};
  for (const c of input.campaigns) {
    const requiredDocTypes = c.promotion_category_id
      ? requiredDocTypesByCategory.get(c.promotion_category_id)
      : undefined;
    const fulfilledDocTypes = fulfilledDocTypesByCampaign.get(c.id);

    let fulfilled = 0;
    if (requiredDocTypes && fulfilledDocTypes) {
      for (const docTypeId of fulfilledDocTypes) {
        if (requiredDocTypes.has(docTypeId)) fulfilled += 1;
      }
    }

    result[c.id] = { required: requiredDocTypes?.size ?? 0, fulfilled };
  }

  return result;
}

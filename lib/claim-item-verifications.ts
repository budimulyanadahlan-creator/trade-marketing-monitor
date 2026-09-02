import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Denormalized label used everywhere the amount item needs a display name
// (claim_events.item_label, UI). There's no document_type row for it — the
// item is told apart by item_type = 'amount', not a document type FK.
export const CLAIM_AMOUNT_ITEM_LABEL = "Nominal Klaim";

/**
 * Creates any missing claim_item_verifications rows for a campaign: one
 * per required document type (from claim_requirements for its promotion
 * category) plus the single 'amount' item, all starting at 'pending'.
 *
 * Idempotent and additive-only — an item that already exists (whatever its
 * status) is left untouched, so this is safe to call both right after a
 * claim is submitted and again later as a self-heal (e.g. a claim that was
 * already claim_submitted when this feature shipped, per the PRD's
 * transition note) without ever resetting a decision finance already made.
 *
 * Pass an admin/service-role client — item creation is a system side
 * effect, not a user decision, and the INSERT policy on
 * claim_item_verifications is scoped to finance/admin/superadmin only.
 */
export async function ensureClaimItemVerifications(
  supabase: SupabaseClient<Database>,
  campaignId: string,
  promotionCategoryId: string | null
): Promise<void> {
  const { data: existing } = await supabase
    .from("claim_item_verifications")
    .select("item_type, document_type_id")
    .eq("campaign_id", campaignId);

  const existingDocIds = new Set(
    (existing ?? [])
      .filter((row) => row.item_type === "document")
      .map((row) => row.document_type_id)
  );
  const hasAmountItem = (existing ?? []).some((row) => row.item_type === "amount");

  const { data: requirements } = promotionCategoryId
    ? await supabase
        .from("claim_requirements")
        .select("document_type_id")
        .eq("promotion_category_id", promotionCategoryId)
    : { data: [] as { document_type_id: string }[] };

  const rowsToInsert: Database["public"]["Tables"]["claim_item_verifications"]["Insert"][] = [];

  for (const req of requirements ?? []) {
    if (!existingDocIds.has(req.document_type_id)) {
      rowsToInsert.push({
        campaign_id: campaignId,
        item_type: "document",
        document_type_id: req.document_type_id,
        status: "pending",
      });
    }
  }

  if (!hasAmountItem) {
    rowsToInsert.push({
      campaign_id: campaignId,
      item_type: "amount",
      document_type_id: null,
      status: "pending",
    });
  }

  if (rowsToInsert.length === 0) return;

  await supabase.from("claim_item_verifications").insert(rowsToInsert);
}

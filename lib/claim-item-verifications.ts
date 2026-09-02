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

/**
 * Resets one claim item back to 'pending' after a distributor fixes it
 * (re-uploads a document, or edits the claim amount) while it was
 * 'revision_requested'. Clears the finance note/actor/decided_at along with
 * it — the item is undecided again, and the original note is already
 * preserved in claim_events' history for that revision request.
 *
 * Pass an admin/service-role client — like ensureClaimItemVerifications,
 * this is a system side effect of a distributor action, not a finance/admin
 * decision, and the UPDATE policy on claim_item_verifications is scoped to
 * finance/admin/superadmin only.
 */
export async function resetClaimItemToPending(
  supabase: SupabaseClient<Database>,
  campaignId: string,
  match: { itemType: "document"; documentTypeId: string } | { itemType: "amount" }
): Promise<void> {
  let query = supabase
    .from("claim_item_verifications")
    .update({
      status: "pending",
      note: null,
      actor_id: null,
      decided_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("campaign_id", campaignId)
    .eq("item_type", match.itemType)
    // Extra guard on top of the caller's own check — a no-op if the item
    // isn't actually revision_requested (e.g. a race with finance deciding
    // it in the meantime), rather than clobbering a fresh decision.
    .eq("status", "revision_requested");

  query =
    match.itemType === "document"
      ? query.eq("document_type_id", match.documentTypeId)
      : query.is("document_type_id", null);

  await query;
}

/**
 * Deletes every claim_item_verifications row for a campaign — used when a
 * claim's verification cycle starts over from scratch: Batalkan Pengajuan,
 * or a new realization moving a paid campaign back to ongoing for its next
 * claim cycle. The next submitKlaimAction / self-heal call to
 * ensureClaimItemVerifications recreates a fresh, all-pending set.
 *
 * Pass an admin/service-role client — no DELETE policy exists on
 * claim_item_verifications (this is a system side effect, not a
 * finance/admin decision).
 */
export async function resetAllClaimItemVerifications(
  supabase: SupabaseClient<Database>,
  campaignId: string
): Promise<void> {
  await supabase.from("claim_item_verifications").delete().eq("campaign_id", campaignId);
}

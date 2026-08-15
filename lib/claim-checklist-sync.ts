import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type ChecklistItemParams = {
  campaignId: string;
  distributorId: string;
  documentTypeId: string;
};

/**
 * Marks a distributor's checklist item as fulfilled after a claim document
 * file was successfully uploaded to it. Idempotent — safe to call for every
 * upload to the same item.
 */
export async function markChecklistFulfilled(
  supabase: SupabaseClient<Database>,
  params: ChecklistItemParams
): Promise<{ error?: string }> {
  const { error } = await supabase.from("distributor_claim_checklists").upsert(
    {
      campaign_id: params.campaignId,
      distributor_id: params.distributorId,
      document_type_id: params.documentTypeId,
      is_fulfilled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id,distributor_id,document_type_id" }
  );

  if (error) return { error: error.message };
  return {};
}

/**
 * After a claim document file is deleted, resets the checklist item back to
 * unfulfilled if that was the last file attached to it. Known limitation: an
 * item that was manually checked *and* later had a file attached will also
 * be unchecked here if that file is removed — distributor_claim_checklists
 * has no way to distinguish "checked via file" from "checked manually" once
 * both have happened to the same item.
 */
export async function syncChecklistAfterFileDelete(
  supabase: SupabaseClient<Database>,
  params: ChecklistItemParams
): Promise<void> {
  const { count } = await supabase
    .from("campaign_files")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", params.campaignId)
    .eq("document_type_id", params.documentTypeId)
    .eq("uploaded_by", params.distributorId);

  if (count && count > 0) return;

  await supabase
    .from("distributor_claim_checklists")
    .update({ is_fulfilled: false, updated_at: new Date().toISOString() })
    .eq("campaign_id", params.campaignId)
    .eq("distributor_id", params.distributorId)
    .eq("document_type_id", params.documentTypeId);
}

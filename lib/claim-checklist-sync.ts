import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type ChecklistItemParams = {
  campaignId: string;
  /** Akun yang memicu perubahan — dicatat sebagai "terakhir diubah oleh". */
  actorId: string;
  documentTypeId: string;
};

/**
 * Marks the SKP's checklist item as fulfilled after a claim document file was
 * successfully uploaded to it. Since Fase 8 (multi-user distributor) the
 * checklist is one row per (SKP, document type) shared by every account of
 * the company — distributor_claim_checklists.distributor_id now means "last
 * modified by". Idempotent — safe to call for every upload to the same item.
 */
export async function markChecklistFulfilled(
  supabase: SupabaseClient<Database>,
  params: ChecklistItemParams
): Promise<{ error?: string }> {
  const { error } = await supabase.from("distributor_claim_checklists").upsert(
    {
      campaign_id: params.campaignId,
      distributor_id: params.actorId,
      document_type_id: params.documentTypeId,
      is_fulfilled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id,document_type_id" }
  );

  if (error) return { error: error.message };
  return {};
}

/**
 * After a claim document file is deleted, resets the SKP's checklist item
 * back to unfulfilled if no file of that document type remains on the SKP —
 * counting files from every uploader, so deleting A's file keeps the item
 * checked while B's file is still there. Known limitation: an item that was
 * manually checked *and* later had a file attached will also be unchecked
 * here if that file is removed — distributor_claim_checklists has no way to
 * distinguish "checked via file" from "checked manually" once both happened.
 */
export async function syncChecklistAfterFileDelete(
  supabase: SupabaseClient<Database>,
  params: ChecklistItemParams
): Promise<void> {
  const { count } = await supabase
    .from("campaign_files")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", params.campaignId)
    .eq("document_type_id", params.documentTypeId);

  if (count && count > 0) return;

  await supabase
    .from("distributor_claim_checklists")
    .update({
      is_fulfilled: false,
      distributor_id: params.actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("campaign_id", params.campaignId)
    .eq("document_type_id", params.documentTypeId);
}

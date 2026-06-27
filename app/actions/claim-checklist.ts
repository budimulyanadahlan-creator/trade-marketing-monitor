"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CampaignStatus } from "@/types/database";

const CHECKLIST_EDITABLE_STATUSES: CampaignStatus[] = [
  "approved",
  "ongoing",
  "claim_submitted",
];

export async function upsertClaimChecklistAction(
  campaignId: string,
  documentTypeId: string,
  isFulfilled: boolean
): Promise<{ error?: string; success?: boolean }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };

    const { data: profile } = await supabase
      .from("users")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (!profile?.is_active) return { error: "Akun tidak aktif" };
    if (profile.role !== "distributor") {
      return { error: "Hanya distributor yang dapat mengupdate checklist" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "SKP tidak ditemukan" };

    if (
      !CHECKLIST_EDITABLE_STATUSES.includes(campaign.status as CampaignStatus)
    ) {
      return {
        error:
          "Checklist hanya dapat diupdate saat SKP berstatus Approved, Ongoing, atau Klaim Diajukan",
      };
    }

    const { error } = await supabase
      .from("distributor_claim_checklists")
      .upsert(
        {
          campaign_id: campaignId,
          distributor_id: user.id,
          document_type_id: documentTypeId,
          is_fulfilled: isFulfilled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "campaign_id,distributor_id,document_type_id" }
      );

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

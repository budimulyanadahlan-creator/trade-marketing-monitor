"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  effectiveSpecialUploaderIds,
  specialDocumentManualCheckError,
} from "@/lib/claim-document-uploaders";
import { fetchAppointedUploadersByDocType } from "@/lib/claim-document-uploaders-data";
import { distributorClaimActionError } from "@/lib/distributor-campaign-guard";
import { nationalParentActivityError } from "@/lib/national-skp";
import type { CampaignStatus } from "@/types/database";

// "claim_submitted" is intentionally excluded — once a claim is submitted,
// checklist changes are locked until it's cancelled (Phase 3) or paid.
const CHECKLIST_EDITABLE_STATUSES: CampaignStatus[] = ["approved", "ongoing"];

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
      .select("role, is_active, distributor_id, distributor_scope, region_id")
      .eq("id", user.id)
      .single();

    if (!profile?.is_active) return { error: "Akun tidak aktif" };
    if (profile.role !== "distributor") {
      return { error: "Hanya distributor yang dapat mengupdate checklist" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select(
        "id, status, distributor_id, region_id, is_national, parent_campaign_id, claim_owner_id, distributor:distributors(parent_distributor_id)"
      )
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "SKP tidak ditemukan" };

    // SKP induk nasional tidak punya checklist — diisi di klaim turunan.
    const nationalError = nationalParentActivityError(campaign);
    if (nationalError) return { error: nationalError };

    const guardError = distributorClaimActionError(
      {
        id: user.id,
        role: profile.role,
        distributor_id: profile.distributor_id ?? null,
        distributor_scope: profile.distributor_scope ?? null,
        region_id: profile.region_id ?? null,
      },
      {
        distributor_id: campaign.distributor_id ?? null,
        region_id: campaign.region_id ?? null,
        parent_campaign_id: campaign.parent_campaign_id ?? null,
        claim_owner_id: campaign.claim_owner_id ?? null,
      }
    );
    if (guardError) return { error: guardError };

    if (
      !CHECKLIST_EDITABLE_STATUSES.includes(campaign.status as CampaignStatus)
    ) {
      return {
        error:
          "Checklist hanya dapat diupdate saat SKP berstatus Approved atau Ongoing",
      };
    }

    // Pengunggah Khusus Fase 2: item terkunci tidak bisa dicentang manual oleh
    // siapa pun — centangnya hanya berubah lewat upload dan hapus file.
    const appointed = await fetchAppointedUploadersByDocType(createAdminClient(), [documentTypeId]);
    const distributorParent = (
      campaign as unknown as { distributor?: { parent_distributor_id: string | null } | null }
    ).distributor;
    const lockedError = specialDocumentManualCheckError(
      effectiveSpecialUploaderIds(
        {
          distributor_id: campaign.distributor_id ?? null,
          distributor_parent_id: distributorParent?.parent_distributor_id ?? null,
        },
        appointed.get(documentTypeId) ?? []
      )
    );
    if (lockedError) return { error: lockedError };

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
        { onConflict: "campaign_id,document_type_id" }
      );

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

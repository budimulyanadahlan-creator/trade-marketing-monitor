"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendClaimHolderTransferredEmail } from "@/lib/email";
import { claimHolderTransferError } from "@/lib/distributor-campaign-guard";

type TransferResult = { error?: string; success?: boolean };

/**
 * Alihkan pemegang klaim (Multi-User Distributor, Fase 10).
 *
 * Hanya admin/superadmin, hanya saat SKP berstatus Klaim Diajukan, dan hanya
 * ke akun distributor aktif dari perusahaan SKP itu (aturan di
 * claimHolderTransferError). Yang berubah hanya `campaigns.claim_submitted_by`
 * — status SKP dan claim_item_verifications tidak disentuh, jadi progres
 * verifikasi Finance tetap utuh.
 */
export async function transferClaimHolderAction(
  campaignId: string,
  newHolderId: string
): Promise<TransferResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };

    const { data: actor } = await supabase
      .from("users")
      .select("id, role, is_active, full_name")
      .eq("id", user.id)
      .maybeSingle();
    if (!actor?.is_active) return { error: "Akun tidak aktif" };

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, name, status, distributor_id, claim_submitted_by")
      .eq("id", campaignId)
      .single();
    if (!campaign) return { error: "SKP tidak ditemukan" };

    const { data: candidate } = await supabase
      .from("users")
      .select("id, role, is_active, full_name, distributor_id")
      .eq("id", newHolderId)
      .maybeSingle();

    const claim = {
      status: campaign.status,
      claim_submitted_by: campaign.claim_submitted_by ?? null,
      distributor_id: campaign.distributor_id ?? null,
    };
    const guardError = claimHolderTransferError(
      { id: actor.id, role: actor.role },
      claim,
      candidate
        ? {
            id: candidate.id,
            role: candidate.role,
            is_active: candidate.is_active,
            distributor_id: candidate.distributor_id ?? null,
          }
        : null
    );
    if (guardError) return { error: guardError };

    const previousHolderId = claim.claim_submitted_by;

    // Syarat status + pemegang lama di WHERE: jika klaim dibatalkan atau
    // dialihkan admin lain di antara baca dan tulis, tidak ada baris yang
    // berubah dan pengalihan ditolak.
    let update = supabase
      .from("campaigns")
      .update({ claim_submitted_by: newHolderId })
      .eq("id", campaignId)
      .eq("status", "claim_submitted");
    update = previousHolderId
      ? update.eq("claim_submitted_by", previousHolderId)
      : update.is("claim_submitted_by", null);
    const { data: updated, error } = await update.select("id");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) {
      return { error: "SKP sudah berubah — muat ulang halaman lalu coba lagi" };
    }

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: pengalihan di atas sudah berhasil.
    try {
      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: actor.id,
        action: "holder_transferred",
        claim_amount: null,
        from_user_id: previousHolderId,
        to_user_id: newHolderId,
      });
    } catch (historyErr) {
      console.error("[transferClaimHolderAction] claim_events insert error:", historyErr);
    }

    // Best-effort: kegagalan email tidak menggagalkan pengalihan.
    try {
      let previousHolderName: string | null = null;
      if (previousHolderId) {
        const { data: prev } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", previousHolderId)
          .maybeSingle();
        previousHolderName = prev?.full_name ?? null;
      }

      const { data: authData } = await createAdminClient().auth.admin.getUserById(newHolderId);
      const email = authData?.user?.email;
      if (email && candidate) {
        await sendClaimHolderTransferredEmail({
          to: [{ email, name: candidate.full_name }],
          campaignId,
          campaignName: campaign.name,
          previousHolderName,
          transferredByName: actor.full_name,
        });
      }
    } catch (notifyErr) {
      console.error("[transferClaimHolderAction] Notification error:", notifyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

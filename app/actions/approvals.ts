"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateSkpNumber } from "@/lib/skp-number";
import type { UserRole, CampaignStatus, ApprovalAction } from "@/types/database";

// Maps campaign status → the approval level sequence required to advance it
const STATUS_TO_SEQ: Partial<Record<CampaignStatus, number>> = {
  submitted: 1,
  approved_l1: 2,
  approved_l2: 3,
  approved_l3: 4,
  approved_l4: 5,
};

async function requireLoggedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, department_id")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) throw new Error("Akun tidak aktif");

  return { supabase, userId: user.id, profile };
}

export type ApprovalResult = { error?: string; success?: boolean };

// ============================================================
// APPROVE
// ============================================================

export async function approveCampaignAction(
  campaignId: string,
  signatureText: string,
  comment: string,
  signatureImage?: string | null
): Promise<ApprovalResult> {
  try {
    if (!signatureText.trim()) return { error: "Tanda tangan (nama lengkap) harus diisi" };
    if (!comment.trim()) return { error: "Komentar persetujuan harus diisi" };

    const { supabase, userId, profile } = await requireLoggedIn();

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("status, name")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign tidak ditemukan" };

    const currentStatus = campaign.status as CampaignStatus;
    const requiredSeq = STATUS_TO_SEQ[currentStatus];

    if (requiredSeq === undefined) {
      return { error: "Status campaign tidak memungkinkan persetujuan" };
    }

    // Get all active approval levels sorted by sequence
    const { data: allLevels } = await supabase
      .from("approval_levels")
      .select("id, name, sequence")
      .eq("is_active", true)
      .order("sequence");

    if (!allLevels || allLevels.length === 0) {
      return { error: "Tidak ada level approval aktif. Hubungi Admin." };
    }

    const requiredLevel = allLevels.find((l) => l.sequence === requiredSeq);
    if (!requiredLevel) {
      return { error: `Level approval urutan ${requiredSeq} tidak dikonfigurasi` };
    }

    // Admin/superadmin bypass assignment check
    if (!["admin", "superadmin"].includes(profile.role)) {
      const { data: assignment } = await supabase
        .from("approver_assignments")
        .select("id")
        .eq("level_id", requiredLevel.id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (!assignment) {
        return {
          error: `Anda tidak ditugaskan sebagai approver ${requiredLevel.name}`,
        };
      }
    }

    // Next status: if this is the last configured level → "approved", else approved_l{seq}
    const maxSeq = allLevels[allLevels.length - 1].sequence;
    const newStatus: CampaignStatus =
      requiredSeq >= maxSeq
        ? "approved"
        : (`approved_l${requiredSeq}` as CampaignStatus);

    const supabaseAdmin = createAdminClient();

    const { error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({ status: newStatus })
      .eq("id", campaignId);

    if (updateError) return { error: updateError.message };

    await supabaseAdmin.from("approval_history").insert({
      campaign_id: campaignId,
      actor_id: userId,
      role: profile.role as UserRole,
      action: newStatus as ApprovalAction,
      signature_text: signatureText.trim(),
      signature_image: signatureImage ?? null,
      comment: comment.trim(),
    });

    revalidatePath("/approvals");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// REJECT
// ============================================================

export async function rejectCampaignAction(
  campaignId: string,
  comment: string
): Promise<ApprovalResult> {
  try {
    if (!comment.trim()) return { error: "Komentar penolakan harus diisi" };

    const { supabase, userId, profile } = await requireLoggedIn();

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign tidak ditemukan" };

    const currentStatus = campaign.status as CampaignStatus;
    const requiredSeq = STATUS_TO_SEQ[currentStatus];

    if (requiredSeq === undefined) {
      return { error: "Status campaign tidak memungkinkan penolakan" };
    }

    // Admin/superadmin bypass
    if (!["admin", "superadmin"].includes(profile.role)) {
      const { data: allLevels } = await supabase
        .from("approval_levels")
        .select("id, name, sequence")
        .eq("is_active", true);

      const requiredLevel = allLevels?.find((l) => l.sequence === requiredSeq);

      if (requiredLevel) {
        const { data: assignment } = await supabase
          .from("approver_assignments")
          .select("id")
          .eq("level_id", requiredLevel.id)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();

        if (!assignment) {
          return {
            error: `Anda tidak ditugaskan sebagai approver ${requiredLevel.name}`,
          };
        }
      }
    }

    const supabaseAdmin = createAdminClient();

    const { error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({ status: "rejected" })
      .eq("id", campaignId);

    if (updateError) return { error: updateError.message };

    await supabaseAdmin.from("approval_history").insert({
      campaign_id: campaignId,
      actor_id: userId,
      role: profile.role as UserRole,
      action: "rejected",
      signature_text: null,
      comment: comment.trim(),
    });

    revalidatePath("/approvals");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// ADMIN APPROVE (single-level, admin/superadmin only)
// ============================================================

export async function adminApproveCampaignAction(
  campaignId: string,
  aaReferenceNumber: string
): Promise<ApprovalResult> {
  try {
    if (!aaReferenceNumber.trim()) return { error: "Nomor AA Reference harus diisi" };

    const { supabase, userId, profile } = await requireLoggedIn();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya admin atau superadmin yang dapat menyetujui SKP" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("status, name")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign tidak ditemukan" };

    if (campaign.status !== "submitted") {
      return { error: "Hanya campaign berstatus 'submitted' yang dapat disetujui" };
    }

    const supabaseAdmin = createAdminClient();
    const skpNumber = await generateSkpNumber(new Date(), supabaseAdmin);

    const { error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({
        status: "approved",
        skp_number: skpNumber,
        aa_reference_number: aaReferenceNumber.trim(),
      })
      .eq("id", campaignId);

    if (updateError) return { error: updateError.message };

    await supabaseAdmin.from("approval_history").insert({
      campaign_id: campaignId,
      actor_id: userId,
      role: profile.role as UserRole,
      action: "approved" as ApprovalAction,
      signature_text: null,
      signature_image: null,
      comment: null,
    });

    revalidatePath("/approvals");
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// ADMIN REJECT (single-level, admin/superadmin only)
// ============================================================

export async function adminRejectCampaignAction(
  campaignId: string,
  comment: string
): Promise<ApprovalResult> {
  try {
    if (!comment.trim()) return { error: "Alasan penolakan harus diisi" };

    const { supabase, userId, profile } = await requireLoggedIn();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya admin atau superadmin yang dapat menolak SKP" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaignId)
      .single();

    if (!campaign) return { error: "Campaign tidak ditemukan" };

    if (campaign.status !== "submitted") {
      return { error: "Hanya campaign berstatus 'submitted' yang dapat ditolak" };
    }

    const supabaseAdmin = createAdminClient();

    const { error: updateError } = await supabaseAdmin
      .from("campaigns")
      .update({ status: "rejected" })
      .eq("id", campaignId);

    if (updateError) return { error: updateError.message };

    await supabaseAdmin.from("approval_history").insert({
      campaign_id: campaignId,
      actor_id: userId,
      role: profile.role as UserRole,
      action: "rejected" as ApprovalAction,
      signature_text: null,
      signature_image: null,
      comment: comment.trim(),
    });

    revalidatePath("/approvals");
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

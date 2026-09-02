"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";
import { sendClaimSubmittedEmail, sendMarkedAsPaidEmail } from "@/lib/email";
import { ensureClaimItemVerifications } from "@/lib/claim-item-verifications";
import type { CampaignStatus } from "@/types/database";

async function requireActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) throw new Error("Akun tidak aktif");
  return { supabase, userId: user.id, profile };
}

// ============================================================
// ADD REALIZATION (Admin only — approved or ongoing campaigns)
// ============================================================

const addRealizationSchema = z.object({
  campaignId: z.string().uuid("ID SKP tidak valid"),
  invoiceNumber: z.string().min(1, "Nomor invoice harus diisi"),
  amount: z.coerce.number().min(1, "Nominal harus lebih dari 0"),
  realizationDate: z
    .string()
    .min(1, "Tanggal realisasi harus diisi")
    .refine(
      (val) => new Date(val) <= new Date(),
      "Tanggal realisasi tidak boleh lebih dari hari ini"
    ),
});

export type AddRealizationResult = {
  error?: string;
  success?: boolean;
  newActualSpent?: number;
  percentSpent?: number;
};

export async function addRealizationAction(
  data: z.infer<typeof addRealizationSchema>
): Promise<AddRealizationResult> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Admin yang dapat mencatat realisasi" };
    }

    const parsed = addRealizationSchema.safeParse(data);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { campaignId, invoiceNumber, amount, realizationDate } = parsed.data;

    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id, status, actual_spent, requested_budget")
      .eq("id", campaignId)
      .single();

    if (fetchError || !campaign) return { error: "SKP tidak ditemukan" };

    const allowedStatuses: CampaignStatus[] = ["approved", "ongoing", "paid"];
    if (!allowedStatuses.includes(campaign.status as CampaignStatus)) {
      return {
        error:
          "Realisasi hanya dapat dicatat pada SKP berstatus Approved, Ongoing, atau Paid",
      };
    }

    const { error: insertError } = await supabase.from("realizations").insert({
      campaign_id: campaignId,
      invoice_number: invoiceNumber,
      amount,
      realization_date: realizationDate,
      created_by: userId,
    });

    if (insertError) return { error: insertError.message };

    // Transition approved/paid → ongoing so the next claim cycle can begin
    if (campaign.status === "approved" || campaign.status === "paid") {
      await supabase
        .from("campaigns")
        .update({ status: "ongoing" as CampaignStatus })
        .eq("id", campaignId);
    }

    const newActualSpent = campaign.actual_spent + amount;
    const percentSpent =
      campaign.requested_budget > 0
        ? (newActualSpent / campaign.requested_budget) * 100
        : 0;

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    return { success: true, newActualSpent, percentSpent };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// DELETE REALIZATION (Admin only)
// ============================================================

export async function deleteRealizationAction(
  realizationId: string,
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Admin yang dapat menghapus realisasi" };
    }

    const { error } = await supabase
      .from("realizations")
      .delete()
      .eq("id", realizationId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// SUBMIT KLAIM (Distributor — ongoing → claim_submitted;
// admin/superadmin can also use this as a fallback)
// ============================================================

const submitKlaimSchema = z.object({
  claimAmount: z.coerce.number().min(1, "Nominal klaim harus lebih dari 0"),
});

export async function submitKlaimAction(
  campaignId: string,
  claimAmount: number
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["distributor", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya distributor atau admin yang dapat mengajukan klaim" };
    }

    const parsed = submitKlaimSchema.safeParse({ claimAmount });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Nominal klaim tidak valid" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status, name, created_by, promotion_category_id")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "ongoing") {
      return {
        error:
          "Hanya SKP berstatus Ongoing yang dapat diajukan klaimnya",
      };
    }

    const submittedAt = new Date().toISOString();

    const { error } = await supabase
      .from("campaigns")
      .update({
        status: "claim_submitted" as CampaignStatus,
        claim_amount: parsed.data.claimAmount,
        claim_submitted_at: submittedAt,
        claim_submitted_by: userId,
      })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: the status change above already succeeded, so a failure
    // recording history or sending notifications shouldn't fail the action.
    try {
      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: userId,
        action: "submitted",
        claim_amount: parsed.data.claimAmount,
      });
    } catch (historyErr) {
      console.error("[submitKlaimAction] claim_events insert error:", historyErr);
    }

    // Best-effort: creates the per-item verification rows (documents +
    // nominal) finance will decide on. Uses the admin client — this is a
    // system side effect of submitting, not a finance/admin decision, and
    // the INSERT policy on claim_item_verifications is scoped to those
    // roles only.
    try {
      await ensureClaimItemVerifications(
        createAdminClient(),
        campaignId,
        campaign.promotion_category_id
      );
    } catch (syncErr) {
      console.error("[submitKlaimAction] claim_item_verifications sync error:", syncErr);
    }

    try {
      await notifyClaimSubmitted({
        campaignId,
        campaignName: campaign.name,
        claimAmount: parsed.data.claimAmount,
        creatorId: campaign.created_by,
        submittedAt,
      });
    } catch (notifyErr) {
      console.error("[submitKlaimAction] Notification error:", notifyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// CANCEL KLAIM (Distributor — claim_submitted → ongoing;
// admin/superadmin can also use this as a fallback)
// ============================================================

export async function cancelKlaimAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["distributor", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya distributor atau admin yang dapat membatalkan klaim" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_submitted") {
      return {
        error: "Hanya SKP berstatus Klaim Diajukan yang dapat dibatalkan",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({
        status: "ongoing" as CampaignStatus,
        claim_amount: null,
        claim_submitted_at: null,
        claim_submitted_by: null,
      })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: the status change above already succeeded, so a failure
    // recording history shouldn't fail the action.
    try {
      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: userId,
        action: "cancelled",
        claim_amount: null,
      });
    } catch (historyErr) {
      console.error("[cancelKlaimAction] claim_events insert error:", historyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

async function notifyClaimSubmitted(opts: {
  campaignId: string;
  campaignName: string;
  claimAmount: number;
  creatorId: string;
  submittedAt: string;
}) {
  const adminClient = createAdminClient();

  const [{ data: financeUsers }, { data: creatorProfile }] = await Promise.all([
    adminClient
      .from("users")
      .select("id, full_name")
      .eq("role", "finance")
      .eq("is_active", true),
    adminClient.from("users").select("id, full_name").eq("id", opts.creatorId).single(),
  ]);

  const nameById = new Map<string, string>();
  const recipientIds = new Set<string>();
  for (const u of financeUsers ?? []) {
    recipientIds.add(u.id);
    nameById.set(u.id, u.full_name);
  }
  if (creatorProfile) {
    recipientIds.add(creatorProfile.id);
    nameById.set(creatorProfile.id, creatorProfile.full_name);
  }

  if (recipientIds.size === 0) return;

  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const recipients = (authData?.users ?? [])
    .filter((u) => recipientIds.has(u.id) && u.email)
    .map((u) => ({ email: u.email!, name: nameById.get(u.id) ?? u.email! }));

  if (recipients.length === 0) return;

  await sendClaimSubmittedEmail({
    to: recipients,
    campaignId: opts.campaignId,
    campaignName: opts.campaignName,
    claimAmount: opts.claimAmount,
    submittedAt: opts.submittedAt,
  });
}

// ============================================================
// APPROVE KLAIM (Finance/Admin/Superadmin —
// claim_submitted → claim_verified)
// ============================================================

// Phase 4 will add the "silakan kirim hardcopy" email on top of this.
export async function approveClaimAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["finance", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Finance atau Admin yang dapat meng-approve klaim" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_submitted") {
      return { error: "Hanya SKP berstatus Klaim Diajukan yang dapat di-approve" };
    }

    // Gate: every item (documents + nominal) must be accepted first. An
    // empty result also blocks — it means the per-item rows haven't been
    // created for this claim yet (e.g. legacy claim_submitted from before
    // this feature), and there's nothing to point to for having verified
    // it; admin/superadmin keep the markAsPaidAction shortcut for those.
    const { data: items } = await supabase
      .from("claim_item_verifications")
      .select("status")
      .eq("campaign_id", campaignId);

    if (!items || items.length === 0 || items.some((item) => item.status !== "accepted")) {
      return {
        error:
          "Approve Klaim hanya dapat dilakukan setelah semua item (dokumen & nominal) berstatus Accepted",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "claim_verified" as CampaignStatus })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: the status change above already succeeded, so a failure
    // recording history shouldn't fail the action.
    try {
      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: userId,
        action: "claim_verified",
        claim_amount: null,
      });
    } catch (historyErr) {
      console.error("[approveClaimAction] claim_events insert error:", historyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// AKAN SEGERA DIBAYAR (Finance/Admin/Superadmin —
// claim_verified → ready_to_pay; pure transition, no email/fields)
// ============================================================

export async function markReadyToPayAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["finance", "admin", "superadmin"].includes(profile.role)) {
      return {
        error: "Hanya Finance atau Admin yang dapat menandai SKP Akan Segera Dibayar",
      };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_verified") {
      return {
        error:
          "Hanya SKP berstatus Terverifikasi yang dapat ditandai Akan Segera Dibayar",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "ready_to_pay" as CampaignStatus })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: the status change above already succeeded, so a failure
    // recording history shouldn't fail the action.
    try {
      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: userId,
        action: "ready_to_pay",
        claim_amount: null,
      });
    } catch (historyErr) {
      console.error("[markReadyToPayAction] claim_events insert error:", historyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// MARK AS PAID (Finance: ready_to_pay → paid;
// Admin/Superadmin also from claim_submitted/claim_verified as a
// transition fallback for claims that predate the verification flow)
// ============================================================

const markAsPaidSchema = z.object({
  paidDate: z
    .string()
    .optional()
    .refine(
      (val) => !val || new Date(val) <= new Date(),
      "Tanggal bayar tidak boleh lebih dari hari ini"
    ),
  note: z.string().trim().max(500, "Catatan maksimal 500 karakter").optional(),
});

export async function markAsPaidAction(
  campaignId: string,
  paidDate?: string,
  note?: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["finance", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Finance atau Admin yang dapat menandai SKP sebagai Paid" };
    }

    const parsed = markAsPaidSchema.safeParse({ paidDate, note });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status, name, claim_amount, distributor_id")
      .eq("id", campaignId)
      .single();

    const payableStatuses: CampaignStatus[] =
      profile.role === "finance"
        ? ["ready_to_pay"]
        : ["claim_submitted", "claim_verified", "ready_to_pay"];

    if (!campaign || !payableStatuses.includes(campaign.status as CampaignStatus)) {
      return {
        error:
          profile.role === "finance"
            ? "Hanya SKP berstatus Akan Segera Dibayar yang dapat ditandai Paid"
            : "Hanya SKP berstatus Klaim Diajukan, Terverifikasi, atau Akan Segera Dibayar yang dapat ditandai Paid",
      };
    }

    const paidAt = parsed.data.paidDate
      ? new Date(parsed.data.paidDate).toISOString()
      : new Date().toISOString();
    const paidNote = parsed.data.note || null;

    const { error } = await supabase
      .from("campaigns")
      .update({
        status: "paid" as CampaignStatus,
        paid_at: paidAt,
        paid_note: paidNote,
      })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");

    // Best-effort: the status change above already succeeded, so a failure
    // sending notifications shouldn't fail the action.
    try {
      await notifyMarkedAsPaid({
        campaignId,
        campaignName: campaign.name,
        claimAmount: campaign.claim_amount,
        distributorId: campaign.distributor_id,
        paidAt,
        paidNote,
      });
    } catch (notifyErr) {
      console.error("[markAsPaidAction] Notification error:", notifyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

async function notifyMarkedAsPaid(opts: {
  campaignId: string;
  campaignName: string;
  claimAmount: number | null;
  distributorId: string | null;
  paidAt: string;
  paidNote: string | null;
}) {
  // Not filtered further than distributor_id — same accepted cross-distributor
  // visibility gap documented for this feature (PRD Keputusan #5).
  if (!opts.distributorId) return;

  const adminClient = createAdminClient();

  const { data: distributorUsers } = await adminClient
    .from("users")
    .select("id, full_name")
    .eq("role", "distributor")
    .eq("distributor_id", opts.distributorId)
    .eq("is_active", true);

  if (!distributorUsers || distributorUsers.length === 0) return;

  const nameById = new Map<string, string>();
  const recipientIds = new Set<string>();
  for (const u of distributorUsers) {
    recipientIds.add(u.id);
    nameById.set(u.id, u.full_name);
  }

  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  const recipients = (authData?.users ?? [])
    .filter((u) => recipientIds.has(u.id) && u.email)
    .map((u) => ({ email: u.email!, name: nameById.get(u.id) ?? u.email! }));

  if (recipients.length === 0) return;

  await sendMarkedAsPaidEmail({
    to: recipients,
    campaignId: opts.campaignId,
    campaignName: opts.campaignName,
    claimAmount: opts.claimAmount,
    paidAt: opts.paidAt,
    paidNote: opts.paidNote,
  });
}

// ============================================================
// MARK AS COMPLETED (Finance/Admin — paid → completed)
// ============================================================

export async function markAsCompletedAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["finance", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Tidak memiliki izin untuk menyelesaikan SKP" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "paid") {
      return {
        error: "Hanya SKP berstatus Paid yang dapat diselesaikan",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "completed" as CampaignStatus })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

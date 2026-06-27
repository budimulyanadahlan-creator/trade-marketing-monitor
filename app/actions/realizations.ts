"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
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
// SUBMIT KLAIM (Admin — ongoing → claim_submitted)
// ============================================================

export async function submitKlaimAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Admin yang dapat mengajukan klaim" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "ongoing") {
      return {
        error:
          "Hanya SKP berstatus Ongoing yang dapat diajukan klaimnya",
      };
    }

    const { count } = await supabase
      .from("realizations")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    if (!count || count === 0) {
      return {
        error: "Input minimal satu realisasi sebelum mengajukan klaim",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "claim_submitted" as CampaignStatus })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// MARK AS PAID (Finance — claim_submitted → paid)
// ============================================================

export async function markAsPaidAction(
  campaignId: string
): Promise<{ error?: string; success?: boolean }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["finance", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Finance yang dapat menandai SKP sebagai Paid" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_submitted") {
      return {
        error:
          "Hanya SKP berstatus Klaim Diajukan yang dapat ditandai Paid",
      };
    }

    const { error } = await supabase
      .from("campaigns")
      .update({ status: "paid" as CampaignStatus })
      .eq("id", campaignId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
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

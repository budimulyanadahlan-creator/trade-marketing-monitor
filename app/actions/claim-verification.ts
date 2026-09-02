"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { CLAIM_AMOUNT_ITEM_LABEL } from "@/lib/claim-item-verifications";
import type { ClaimItemStatus } from "@/types/database";

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

type DecideItemResult = { error?: string; success?: boolean };

// Shared by acceptClaimItemAction and requestClaimItemRevisionAction: same
// role/status gating and the same claim_events audit trail, differing only
// in the resulting status and whether a note is required.
async function decideClaimItem(
  campaignId: string,
  itemId: string,
  status: Extract<ClaimItemStatus, "accepted" | "revision_requested">,
  note: string | null
): Promise<DecideItemResult> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    if (!["finance", "admin", "superadmin"].includes(profile.role)) {
      return { error: "Hanya Finance atau Admin yang dapat memverifikasi item klaim" };
    }

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_submitted") {
      return {
        error: "Item hanya dapat diverifikasi saat SKP berstatus Klaim Diajukan",
      };
    }

    const { data: item } = await supabase
      .from("claim_item_verifications")
      .select("id, campaign_id, item_type, claim_document_types(name)")
      .eq("id", itemId)
      .single();

    if (!item || item.campaign_id !== campaignId) {
      return { error: "Item verifikasi tidak ditemukan" };
    }

    const decidedAt = new Date().toISOString();

    const { error } = await supabase
      .from("claim_item_verifications")
      .update({
        status,
        note,
        actor_id: userId,
        decided_at: decidedAt,
        updated_at: decidedAt,
      })
      .eq("id", itemId);

    if (error) return { error: error.message };

    revalidatePath(`/campaigns/${campaignId}`);

    // Best-effort: the decision above already succeeded, so a failure
    // recording history shouldn't fail the action.
    try {
      const docType = item.claim_document_types as { name: string } | null;
      const itemLabel = item.item_type === "amount" ? CLAIM_AMOUNT_ITEM_LABEL : docType?.name ?? "Dokumen";

      await supabase.from("claim_events").insert({
        campaign_id: campaignId,
        actor_id: userId,
        action: status === "accepted" ? "item_accepted" : "item_revision_requested",
        claim_amount: null,
        note,
        item_label: itemLabel,
      });
    } catch (historyErr) {
      console.error("[decideClaimItem] claim_events insert error:", historyErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

const noteSchema = z.string().trim().max(500, "Catatan maksimal 500 karakter");

export async function acceptClaimItemAction(
  campaignId: string,
  itemId: string,
  note?: string
): Promise<DecideItemResult> {
  const parsed = noteSchema.optional().safeParse(note);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Catatan tidak valid" };
  }

  return decideClaimItem(campaignId, itemId, "accepted", parsed.data || null);
}

const revisionNoteSchema = noteSchema.min(1, "Catatan wajib diisi saat meminta revisi");

export async function requestClaimItemRevisionAction(
  campaignId: string,
  itemId: string,
  note: string
): Promise<DecideItemResult> {
  const parsed = revisionNoteSchema.safeParse(note);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Catatan tidak valid" };
  }

  return decideClaimItem(campaignId, itemId, "revision_requested", parsed.data);
}

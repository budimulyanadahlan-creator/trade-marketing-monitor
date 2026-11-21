"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";
import { sendClaimRevisionRequestedEmail } from "@/lib/email";
import { getDistributorNotificationRecipients } from "@/lib/distributor-notification-recipients";
import { CLAIM_AMOUNT_ITEM_LABEL } from "@/lib/claim-item-verifications";
import {
  effectiveSpecialUploaderIds,
  specialDocumentAcceptError,
} from "@/lib/claim-document-uploaders";
import { fetchAppointedUploadersByDocType } from "@/lib/claim-document-uploaders-data";
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
      .select("id, status, name, distributor_id, distributor:distributors(parent_distributor_id)")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.status !== "claim_submitted") {
      return {
        error: "Item hanya dapat diverifikasi saat SKP berstatus Klaim Diajukan",
      };
    }

    const { data: item } = await supabase
      .from("claim_item_verifications")
      .select("id, campaign_id, item_type, document_type_id, claim_document_types(name)")
      .eq("id", itemId)
      .single();

    if (!item || item.campaign_id !== campaignId) {
      return { error: "Item verifikasi tidak ditemukan" };
    }

    // Pengunggah Khusus Fase 5: item dokumen terkunci tidak bisa di-Accept
    // sebelum filenya ada. Minta Revisi dan item lain tidak terpengaruh.
    if (status === "accepted" && item.item_type === "document" && item.document_type_id) {
      const lockedError = await lockedDocumentAcceptError({
        campaignId,
        documentTypeId: item.document_type_id,
        distributorId: campaign.distributor_id ?? null,
        distributorParentId:
          (campaign as unknown as { distributor?: { parent_distributor_id: string | null } | null })
            .distributor?.parent_distributor_id ?? null,
      });
      if (lockedError) return { error: lockedError };
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

    const docType = item.claim_document_types as { name: string } | null;
    const itemLabel = item.item_type === "amount" ? CLAIM_AMOUNT_ITEM_LABEL : docType?.name ?? "Dokumen";

    // Best-effort: the decision above already succeeded, so a failure
    // recording history shouldn't fail the action.
    try {
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

    // Best-effort: notify the distributor by email on Minta Revisi only
    // (Phase 4 — Accept per item stays silent per the PRD).
    if (status === "revision_requested") {
      try {
        await notifyClaimRevisionRequested({
          campaignId,
          campaignName: campaign.name,
          distributorId: campaign.distributor_id,
          itemLabel,
          note: note ?? "",
        });
      } catch (notifyErr) {
        console.error("[decideClaimItem] Notification error:", notifyErr);
      }
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

/**
 * Pesan penolakan Accept bila jenis dokumen ini terkunci pada SKP ini
 * (punya pengunggah khusus efektif) dan belum ada filenya; null jika boleh.
 * Aturannya di lib/claim-document-uploaders.ts. Penunjukan dan jumlah file
 * dibaca lewat klien sistem — ini pencarian otorisasi, tidak boleh
 * bergantung pada apa yang kebetulan terlihat lewat RLS.
 */
async function lockedDocumentAcceptError(opts: {
  campaignId: string;
  documentTypeId: string;
  distributorId: string | null;
  distributorParentId: string | null;
}): Promise<string | null> {
  const admin = createAdminClient();
  const appointed = await fetchAppointedUploadersByDocType(admin, [opts.documentTypeId]);
  const effectiveUploaderIds = effectiveSpecialUploaderIds(
    { distributor_id: opts.distributorId, distributor_parent_id: opts.distributorParentId },
    appointed.get(opts.documentTypeId) ?? []
  );
  if (effectiveUploaderIds.length === 0) return null;

  const { count, error } = await admin
    .from("campaign_files")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", opts.campaignId)
    .eq("document_type_id", opts.documentTypeId);
  if (error) return error.message;

  return specialDocumentAcceptError(effectiveUploaderIds, count ?? 0);
}

async function notifyClaimRevisionRequested(opts: {
  campaignId: string;
  campaignName: string;
  distributorId: string | null;
  itemLabel: string;
  note: string;
}) {
  if (!opts.distributorId) return;

  // Fase 11: pemegang klaim + Pusat perusahaan SKP + Pusat induk.
  const recipients = await getDistributorNotificationRecipients(
    createAdminClient(),
    opts.campaignId,
    "after_claim"
  );
  if (recipients.length === 0) return;

  await sendClaimRevisionRequestedEmail({
    to: recipients,
    campaignId: opts.campaignId,
    campaignName: opts.campaignName,
    itemLabel: opts.itemLabel,
    note: opts.note,
  });
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

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
      .select(
        "id, status, name, skp_number, distributor_id, distributor:distributors(name, parent_distributor_id), region:regions(name)"
      )
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

    const joined = campaign as unknown as {
      skp_number?: string | null;
      distributor?: { name?: string | null; parent_distributor_id: string | null } | null;
      region?: { name?: string | null } | null;
    };
    const distributorParentId = joined.distributor?.parent_distributor_id ?? null;
    const documentTypeId = item.item_type === "document" ? (item.document_type_id ?? null) : null;

    // Pengunggah Khusus Fase 5: item dokumen terkunci tidak bisa di-Accept
    // sebelum filenya ada. Minta Revisi dan item lain tidak terpengaruh.
    if (status === "accepted" && documentTypeId) {
      const lockedError = await lockedDocumentAcceptError({
        campaignId,
        documentTypeId,
        distributorId: campaign.distributor_id ?? null,
        distributorParentId,
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
          skpNumber: joined.skp_number ?? null,
          distributorId: campaign.distributor_id,
          distributorParentId,
          distributorName: joined.distributor?.name ?? null,
          regionName: joined.region?.name ?? null,
          documentTypeId,
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
  const effectiveUploaderIds = await fetchEffectiveUploaderIds(admin, opts);
  if (effectiveUploaderIds.length === 0) return null;

  const { count, error } = await admin
    .from("campaign_files")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", opts.campaignId)
    .eq("document_type_id", opts.documentTypeId);
  if (error) return error.message;

  return specialDocumentAcceptError(effectiveUploaderIds, count ?? 0);
}

/** Pengunggah khusus efektif sebuah jenis dokumen pada sebuah SKP (klien sistem). */
async function fetchEffectiveUploaderIds(
  admin: ReturnType<typeof createAdminClient>,
  opts: { documentTypeId: string; distributorId: string | null; distributorParentId: string | null }
): Promise<string[]> {
  const appointed = await fetchAppointedUploadersByDocType(admin, [opts.documentTypeId]);
  return effectiveSpecialUploaderIds(
    { distributor_id: opts.distributorId, distributor_parent_id: opts.distributorParentId },
    appointed.get(opts.documentTypeId) ?? []
  );
}

async function notifyClaimRevisionRequested(opts: {
  campaignId: string;
  campaignName: string;
  skpNumber: string | null;
  distributorId: string | null;
  distributorParentId: string | null;
  distributorName: string | null;
  regionName: string | null;
  /** Jenis dokumen item yang direvisi; null untuk nominal klaim. */
  documentTypeId: string | null;
  itemLabel: string;
  note: string;
}) {
  if (!opts.distributorId) return;
  const admin = createAdminClient();

  // Pengunggah Khusus Fase 6: revisi item dokumen terkunci ditujukan ke
  // pengunggah khusus efektifnya, bukan pemegang klaim (yang tidak bisa
  // mengunggah dokumen itu). Bila pencarian ini gagal, email tidak dikirim
  // sama sekali daripada salah alamat — pemanggil menangkap error-nya.
  const specialUploaderIds = opts.documentTypeId
    ? await fetchEffectiveUploaderIds(admin, {
        documentTypeId: opts.documentTypeId,
        distributorId: opts.distributorId,
        distributorParentId: opts.distributorParentId,
      })
    : [];

  // Fase 11: pemegang klaim + Pusat perusahaan SKP + Pusat induk; item
  // terkunci: pengunggah khusus menggantikan pemegang klaim.
  const recipients = await getDistributorNotificationRecipients(
    admin,
    opts.campaignId,
    "after_claim",
    { specialUploaderIds }
  );
  if (recipients.length === 0) return;

  await sendClaimRevisionRequestedEmail({
    to: recipients,
    campaignId: opts.campaignId,
    campaignName: opts.campaignName,
    skpNumber: opts.skpNumber,
    distributorName: opts.distributorName,
    regionName: opts.regionName,
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

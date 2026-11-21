/**
 * Pembersihan data lama item terkunci (Pengunggah Khusus Fase 8,
 * plans/prd-pengunggah-khusus-dokumen-klaim.md).
 *
 * Sebelum ada pengunggah khusus, cabang bisa mencentang dokumen tanpa file.
 * Begitu sebuah jenis dokumen terkunci, centangnya hanya boleh mengikuti file
 * — centang lama tanpa file membuat kelengkapan terlihat penuh padahal
 * suratnya belum ada. Modul ini menentukan centang mana yang dilepas oleh
 * skrip sekali jalan scripts/cleanup-locked-claim-checklists.mjs.
 *
 * Dilepas: centang item TERKUNCI yang tercentang TANPA file, pada SKP
 * berstatus Disetujui / Berjalan / Klaim Diajukan, selama item verifikasinya
 * belum Accept. Tidak pernah: file apa pun, item yang sudah di-Accept, SKP
 * yang sudah lewat verifikasi, SKP induk nasional, item tidak terkunci.
 *
 * Murni, tanpa I/O. Aturan "terkunci" tetap di lib/claim-document-uploaders.ts
 * (effectiveSpecialUploaderIds). Hasilnya kosong begitu dijalankan sekali,
 * jadi skripnya idempoten.
 */

import {
  effectiveSpecialUploaderIds,
  type AppointedUploader,
} from "@/lib/claim-document-uploaders";

/** Sama dengan jendela status pengunggah khusus (specialDocumentWindowError). */
export const LOCKED_CHECKLIST_CLEANUP_STATUSES = ["approved", "ongoing", "claim_submitted"];

export type CleanupCampaign = {
  id: string;
  status: string;
  is_national?: boolean | null;
  distributor_id: string | null;
  /** Induk perusahaan SKP (`distributors.parent_distributor_id`). */
  distributor_parent_id?: string | null;
};

export type LockedChecklistCleanupTarget = {
  checklistId: string;
  campaignId: string;
  documentTypeId: string;
};

export function computeLockedChecklistCleanup(input: {
  campaigns: CleanupCampaign[];
  appointedByDocType: Map<string, AppointedUploader[]>;
  checklists: {
    id: string;
    campaign_id: string;
    document_type_id: string;
    is_fulfilled: boolean;
  }[];
  files: { campaign_id: string; document_type_id: string | null }[];
  itemVerifications: { campaign_id: string; document_type_id: string | null; status: string }[];
}): LockedChecklistCleanupTarget[] {
  const key = (campaignId: string, docTypeId: string) => `${campaignId}|${docTypeId}`;
  const campaignById = new Map(input.campaigns.map((c) => [c.id, c]));
  const withFile = new Set<string>();
  for (const f of input.files) {
    if (f.document_type_id) withFile.add(key(f.campaign_id, f.document_type_id));
  }
  const accepted = new Set<string>();
  for (const v of input.itemVerifications) {
    if (v.document_type_id && v.status === "accepted") {
      accepted.add(key(v.campaign_id, v.document_type_id));
    }
  }

  const targets: LockedChecklistCleanupTarget[] = [];
  for (const row of input.checklists) {
    if (!row.is_fulfilled) continue;
    const campaign = campaignById.get(row.campaign_id);
    if (!campaign || campaign.is_national) continue;
    if (!LOCKED_CHECKLIST_CLEANUP_STATUSES.includes(campaign.status)) continue;

    const locked =
      effectiveSpecialUploaderIds(
        campaign,
        input.appointedByDocType.get(row.document_type_id) ?? []
      ).length > 0;
    if (!locked) continue;

    const k = key(row.campaign_id, row.document_type_id);
    if (withFile.has(k) || accepted.has(k)) continue;

    targets.push({
      checklistId: row.id,
      campaignId: row.campaign_id,
      documentTypeId: row.document_type_id,
    });
  }
  return targets;
}

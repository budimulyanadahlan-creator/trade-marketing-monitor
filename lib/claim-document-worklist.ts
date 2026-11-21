/**
 * Daftar kerja pengunggah khusus (Pengunggah Khusus Fase 7,
 * plans/prd-pengunggah-khusus-dokumen-klaim.md).
 *
 * Sebuah SKP masuk daftar kerja sebuah akun bila akun itu pengunggah khusus
 * efektif untuk jenis dokumen yang WAJIB bagi kategori promosi SKP itu, status
 * SKP Disetujui / Berjalan / Klaim Diajukan, dan belum ada file jenis itu ATAU
 * itemnya sedang diminta revisi.
 *
 * Urutan: diminta revisi (1) → Klaim Diajukan tanpa file (2) → Disetujui /
 * Berjalan tanpa file (3). SKP induk nasional dan klaim turunan yang
 * dibatalkan tidak pernah masuk; klaim turunan aktif masuk.
 *
 * Murni, tanpa I/O, dan dihitung secara batch dari data daftar SKP yang sudah
 * diambil — tidak ada query per baris. Aturan "pengunggah khusus efektif"
 * tetap di lib/claim-document-uploaders.ts.
 */

import {
  effectiveSpecialUploaderIds,
  type AppointedUploader,
} from "@/lib/claim-document-uploaders";

/** 1 = paling mendesak. */
export type SpecialUploaderWorklistPriority = 1 | 2 | 3;

export type WorklistCampaign = {
  id: string;
  status: string;
  is_national?: boolean | null;
  parent_campaign_id?: string | null;
  distributor_id: string | null;
  /** Induk perusahaan SKP (`distributors.parent_distributor_id`). */
  distributor_parent_id?: string | null;
  promotion_category_id: string | null;
};

/**
 * Prioritas satu item dokumen terkunci pada sebuah SKP, atau null bila tidak
 * ada yang ditunggu dari pengunggah khususnya. `itemStatus` = status baris
 * claim_item_verifications dokumen itu (null bila belum ada barisnya).
 */
export function specialUploaderWorklistPriority(
  campaign: Pick<WorklistCampaign, "status" | "is_national" | "parent_campaign_id">,
  hasFile: boolean,
  itemStatus: string | null | undefined
): SpecialUploaderWorklistPriority | null {
  if (campaign.is_national) return null;
  if (campaign.status === "approved" || campaign.status === "ongoing") {
    return hasFile ? null : 3;
  }
  if (campaign.status === "claim_submitted") {
    if (itemStatus === "accepted") return null;
    if (itemStatus === "revision_requested") return 1;
    return hasFile ? null : 2;
  }
  return null;
}

/**
 * Daftar kerja `actorId`: ID SKP → prioritas paling mendesak di antara jenis
 * dokumen yang ia pegang. SKP yang tidak menunggu apa pun tidak ada di hasil.
 */
export function computeSpecialUploaderWorklist(input: {
  actorId: string;
  campaigns: WorklistCampaign[];
  appointedByDocType: Map<string, AppointedUploader[]>;
  requirements: { promotion_category_id: string; document_type_id: string }[];
  files: { campaign_id: string; document_type_id: string | null }[];
  itemVerifications: { campaign_id: string; document_type_id: string | null; status: string }[];
}): Record<string, SpecialUploaderWorklistPriority> {
  const requiredByCategory = new Map<string, string[]>();
  for (const r of input.requirements) {
    if (!input.appointedByDocType.has(r.document_type_id)) continue;
    const list = requiredByCategory.get(r.promotion_category_id) ?? [];
    list.push(r.document_type_id);
    requiredByCategory.set(r.promotion_category_id, list);
  }

  const key = (campaignId: string, docTypeId: string) => `${campaignId}|${docTypeId}`;
  const withFile = new Set<string>();
  for (const f of input.files) {
    if (f.document_type_id) withFile.add(key(f.campaign_id, f.document_type_id));
  }
  const itemStatus = new Map<string, string>();
  for (const v of input.itemVerifications) {
    if (v.document_type_id) itemStatus.set(key(v.campaign_id, v.document_type_id), v.status);
  }

  const result: Record<string, SpecialUploaderWorklistPriority> = {};
  for (const c of input.campaigns) {
    if (!c.promotion_category_id) continue;
    for (const docTypeId of requiredByCategory.get(c.promotion_category_id) ?? []) {
      const effective = effectiveSpecialUploaderIds(
        c,
        input.appointedByDocType.get(docTypeId) ?? []
      );
      if (!effective.includes(input.actorId)) continue;
      const k = key(c.id, docTypeId);
      const priority = specialUploaderWorklistPriority(c, withFile.has(k), itemStatus.get(k));
      if (priority !== null && (result[c.id] === undefined || priority < result[c.id])) {
        result[c.id] = priority;
      }
    }
  }
  return result;
}

/** Hanya baris dalam daftar kerja, paling mendesak dulu (urutan asal stabil). */
export function sortBySpecialUploaderWorklist<T extends { id: string }>(
  rows: T[],
  worklist: Record<string, SpecialUploaderWorklistPriority>
): T[] {
  return rows
    .filter((r) => worklist[r.id] !== undefined)
    .sort((a, b) => worklist[a.id] - worklist[b.id]);
}

/**
 * Label filter daftar kerja dari nama jenis dokumen yang dipegang akun, atau
 * null bila akun tidak ditunjuk untuk jenis dokumen apa pun.
 */
export function specialUploaderWorklistLabel(documentTypeNames: string[]): string | null {
  if (documentTypeNames.length === 0) return null;
  if (documentTypeNames.length === 1) return `Menunggu ${documentTypeNames[0]}`;
  return "Menunggu dokumen saya";
}

export const SPECIAL_UPLOADER_WORKLIST_PRIORITY_LABELS: Record<
  SpecialUploaderWorklistPriority,
  string
> = {
  1: "Revisi diminta",
  2: "Klaim sudah diajukan",
  3: "Belum diunggah",
};

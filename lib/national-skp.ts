/**
 * Aturan SKP Nasional (plans/prd-skp-nasional.md, plans/plan-skp-nasional.md).
 *
 * SKP induk nasional (`campaigns.is_national`) adalah satu SKP yang terlihat
 * oleh semua akun distributor di semua perusahaan dan region, tanpa
 * distributor dan ber-region National. Induk tidak menerima aktivitas klaim
 * apa pun — realisasi, pengajuan klaim, checklist, dokumen klaim, dan tanda
 * terima terjadi di klaim turunan.
 *
 * Fase 1: syarat Jadikan / Batalkan Nasional dan penolakan aktivitas klaim
 * pada induk. Akses lihat distributor ada di lib/distributor-campaign-guard.ts.
 * Padanan di database: migrasi 074 (constraint + trigger).
 *
 * Murni, tanpa I/O — pemanggil menyediakan kolom SKP dan hitungan aktivitas.
 */

import { isDistributorRequiredDepartment } from "./campaign-distributor-required";

export const NATIONAL_REGION_NAME = "National";

export const NATIONAL_SKP_MESSAGES = {
  notAdmin: "Hanya admin yang dapat mengubah tanda SKP Nasional",
  notApproved: "Hanya SKP berstatus Disetujui yang dapat dijadikan SKP Nasional",
  alreadyNational: "SKP ini sudah bertanda Nasional",
  notNational: "SKP ini bukan SKP Nasional",
  departmentNotVisible:
    "Hanya SKP departemen Sales / Trade Marketing yang dapat dijadikan SKP Nasional — departemen lain tidak terlihat oleh distributor",
  hasChildClaims:
    "Tanda Nasional tidak dapat dicabut karena SKP ini sudah punya klaim turunan",
  parentActivity:
    "SKP Nasional tidak menerima realisasi, klaim, checklist, dokumen klaim, atau tanda terima secara langsung — aktivitas klaim dilakukan di klaim turunan",
} as const;

export type NationalActor = { role: string };

function isAdminRole(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

/** true = baris ini SKP induk nasional. */
export function isNationalParent(
  campaign: { is_national?: boolean | null } | null | undefined
): boolean {
  return !!campaign?.is_national;
}

// ============================================================
// Jadikan Nasional
// ============================================================

export type MakeNationalTarget = {
  status: string;
  is_national?: boolean | null;
  departmentName: string | null | undefined;
  claim_amount: number | null;
  claim_submitted_by: string | null;
};

/** Hitungan aktivitas klaim yang sudah menempel pada SKP. */
export type MakeNationalActivity = {
  realizations: number;
  fulfilledChecklistItems: number;
  /** campaign_files dengan document_type_id terisi. */
  claimDocuments: number;
  receipts: number;
  claimEvents: number;
};

/**
 * Pesan error jika SKP tidak boleh dijadikan nasional, atau null jika boleh.
 * Hanya admin/superadmin, hanya SKP Disetujui (Sales/TM) yang belum punya
 * klaim, checklist terisi, dokumen klaim, tanda terima, atau realisasi.
 */
export function makeNationalError(
  actor: NationalActor,
  campaign: MakeNationalTarget,
  activity: MakeNationalActivity
): string | null {
  const m = NATIONAL_SKP_MESSAGES;
  if (!isAdminRole(actor.role)) return m.notAdmin;
  if (campaign.is_national) return m.alreadyNational;
  if (campaign.status !== "approved") return m.notApproved;
  if (!isDistributorRequiredDepartment(campaign.departmentName)) return m.departmentNotVisible;

  const blockers: string[] = [];
  if (campaign.claim_amount != null || campaign.claim_submitted_by || activity.claimEvents > 0) {
    blockers.push("klaim");
  }
  if (activity.fulfilledChecklistItems > 0) blockers.push("checklist terisi");
  if (activity.claimDocuments > 0) blockers.push("dokumen klaim");
  if (activity.receipts > 0) blockers.push("tanda terima");
  if (activity.realizations > 0) blockers.push("realisasi");

  if (blockers.length === 0) return null;
  return `SKP tidak dapat dijadikan Nasional karena sudah punya ${blockers.join(", ")}. Bereskan dulu, lalu coba lagi.`;
}

// ============================================================
// Batalkan Nasional
// ============================================================

/**
 * Pesan error jika tanda nasional tidak boleh dicabut, atau null jika boleh.
 * Klaim turunan (status apa pun, termasuk Dibatalkan) mengunci tanda nasional.
 */
export function unmakeNationalError(
  actor: NationalActor,
  campaign: { is_national?: boolean | null },
  childClaimCount: number
): string | null {
  const m = NATIONAL_SKP_MESSAGES;
  if (!isAdminRole(actor.role)) return m.notAdmin;
  if (!campaign.is_national) return m.notNational;
  if (childClaimCount > 0) return m.hasChildClaims;
  return null;
}

// ============================================================
// Induk tidak menerima aktivitas klaim
// ============================================================

/**
 * Pesan error untuk aksi realisasi, pengajuan klaim, checklist, unggah
 * dokumen klaim, dan tanda terima pada SKP induk nasional; null untuk SKP
 * lain. Berlaku untuk semua role, termasuk admin.
 */
export function nationalParentActivityError(
  campaign: { is_national?: boolean | null }
): string | null {
  return campaign.is_national ? NATIONAL_SKP_MESSAGES.parentActivity : null;
}

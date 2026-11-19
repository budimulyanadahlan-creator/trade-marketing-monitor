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
  childNotDistributor: "Hanya akun distributor yang dapat membuat klaim atas SKP Nasional",
  childInactive: "Akun tidak aktif",
  childNoCompany: "Akun Anda belum terhubung ke perusahaan distributor",
  childParentNotApproved:
    "Klaim hanya dapat dibuat pada SKP Nasional berstatus Disetujui",
  childParentNoNumber: "SKP Nasional ini belum bernomor — hubungi admin Marmot",
  childOpenClaimExists:
    "Selesaikan atau batalkan klaim Anda yang belum diajukan sebelum membuat klaim baru",
  childNoReceipt: "Klaim SKP Nasional tidak memakai tanda terima",
  cancelNotChild: "Hanya klaim atas SKP Nasional yang dapat dibatalkan lewat tombol ini",
  cancelNotOwner: "Hanya pemilik klaim atau admin yang dapat membatalkan klaim ini",
  cancelHasRealization:
    "Klaim tidak dapat dibatalkan karena sudah punya realisasi — hubungi Finance",
  cancelAlreadySubmitted:
    "Klaim yang sudah diajukan tidak dapat dibatalkan di sini — gunakan Batalkan Pengajuan selama klaim belum disetujui",
  cancelAlreadyCancelled: "Klaim ini sudah dibatalkan",
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

// ============================================================
// Klaim turunan (Fase 2)
//
// Klaim turunan adalah baris SKP biasa yang menunjuk ke SKP induk nasional
// (`parent_campaign_id`) dan dikunci ke akun pembuatnya (`claim_owner_id`).
// Seluruh alur klaim yang ada berjalan di baris itu tanpa diubah. Padanan di
// database: migrasi 075 (constraint, trigger, dan fungsi
// create_national_child_claim yang mengalokasikan nomor urut secara atomik).
// ============================================================

/** true = baris ini klaim turunan SKP nasional. */
export function isNationalChild(
  campaign: { parent_campaign_id?: string | null } | null | undefined
): boolean {
  return !!campaign?.parent_campaign_id;
}

export type ChildClaimActor = {
  role: string;
  is_active: boolean;
  distributor_id: string | null;
};

export type ChildClaimParent = {
  status: string;
  is_national?: boolean | null;
  parent_campaign_id?: string | null;
  skp_number: string | null;
};

/**
 * Pesan error jika akun tidak boleh membuat klaim turunan atas SKP ini, atau
 * null jika boleh. `openChildClaims` = jumlah klaim turunan akun itu atas
 * induk yang sama yang belum diajukan (status Disetujui atau Berjalan).
 */
export function createChildClaimError(
  actor: ChildClaimActor,
  parent: ChildClaimParent,
  openChildClaims: number
): string | null {
  const m = NATIONAL_SKP_MESSAGES;
  if (actor.role !== "distributor") return m.childNotDistributor;
  if (!actor.is_active) return m.childInactive;
  if (!actor.distributor_id) return m.childNoCompany;
  if (!parent.is_national || parent.parent_campaign_id) return m.notNational;
  if (parent.status !== "approved") return m.childParentNotApproved;
  if (!parent.skp_number) return m.childParentNoNumber;
  if (openChildClaims > 0) return m.childOpenClaimExists;
  return null;
}

/** Nomor klaim turunan: nomor induk + `-K` + nomor urut dua digit. */
export function childSkpNumber(parentSkpNumber: string, seq: number): string {
  return `${parentSkpNumber}-K${String(seq).padStart(2, "0")}`;
}

/**
 * Nama klaim turunan: nama induk + " – klaim " + nama akun; mulai klaim
 * kedua akun itu atas induk yang sama ditambah nomor urutnya.
 */
export function childClaimName(parentName: string, ownerName: string, ownerClaimNo: number): string {
  const base = `${parentName} – klaim ${ownerName}`;
  return ownerClaimNo > 1 ? `${base} (${ownerClaimNo})` : base;
}

/**
 * Pesan error untuk aksi tanda terima: induk nasional dan klaim turunannya
 * tidak memakai tanda terima; null untuk SKP biasa.
 */
export function nationalReceiptError(
  campaign: { is_national?: boolean | null; parent_campaign_id?: string | null }
): string | null {
  if (campaign.is_national) return NATIONAL_SKP_MESSAGES.parentActivity;
  if (campaign.parent_campaign_id) return NATIONAL_SKP_MESSAGES.childNoReceipt;
  return null;
}

// ============================================================
// Klaim berulang dan pembatalan (Fase 3)
//
// Satu akun boleh menagih SKP induk yang sama berkali-kali, tetapi hanya
// punya satu klaim turunan yang belum diajukan pada satu waktu. Klaim yang
// salah buat dibatalkan oleh pemiliknya (atau admin) selama belum ada
// realisasi dan belum diajukan; baris, dokumen, dan nomor urutnya tetap ada.
// Padanan di database: migrasi 076 (fungsi cancel_national_child_claim dan
// trigger penjaga peralihan status Dibatalkan).
// ============================================================

/** Status klaim turunan yang belum diajukan — menghalangi klaim baru akun itu. */
export const OPEN_CHILD_CLAIM_STATUSES = ["approved", "ongoing"] as const;

/** true = klaim turunan berstatus ini masih "belum diajukan". */
export function isOpenChildClaimStatus(status: string): boolean {
  return (OPEN_CHILD_CLAIM_STATUSES as readonly string[]).includes(status);
}

export type CancelChildClaimActor = { id: string; role: string; is_active: boolean };

export type CancelChildClaimTarget = {
  parent_campaign_id?: string | null;
  claim_owner_id?: string | null;
  status: string;
};

/**
 * Pesan error jika klaim turunan tidak boleh dibatalkan oleh akun ini, atau
 * null jika boleh. Hanya pemilik atau admin/superadmin, hanya saat berstatus
 * Disetujui dan belum punya realisasi (`realizationCount` = jumlah catatan
 * realisasi pada klaim itu).
 */
export function cancelChildClaimError(
  actor: CancelChildClaimActor,
  child: CancelChildClaimTarget,
  realizationCount: number
): string | null {
  const m = NATIONAL_SKP_MESSAGES;
  if (!actor.is_active) return m.childInactive;
  if (!child.parent_campaign_id) return m.cancelNotChild;

  const isOwner =
    actor.role === "distributor" && !!child.claim_owner_id && child.claim_owner_id === actor.id;
  if (!isOwner && !isAdminRole(actor.role)) return m.cancelNotOwner;

  if (child.status === "cancelled") return m.cancelAlreadyCancelled;
  // Berjalan = Finance sudah mencatat realisasi.
  if (child.status === "ongoing" || realizationCount > 0) return m.cancelHasRealization;
  if (child.status !== "approved") return m.cancelAlreadySubmitted;
  return null;
}

/**
 * Pengunggah khusus dokumen klaim (plans/prd-pengunggah-khusus-dokumen-klaim.md).
 *
 * Admin menunjuk satu atau lebih akun distributor bercakupan Pusat sebagai
 * pengunggah khusus sebuah jenis dokumen klaim (tabel
 * `claim_document_type_uploaders`, migrasi 082). Modul ini adalah sumber
 * kebenaran sisi aplikasi untuk aturan penunjukan itu.
 *
 * Fase 1: aturan penunjukan (siapa yang boleh ditunjuk, kapan penunjukan
 * dihitung). Fase 2: "pengunggah khusus efektif" per SKP dan keputusan
 * upload / hapus / centang manual untuk item terkunci. Fase 3: jangkauan
 * lintas perusahaan — SKP anak perusahaan dan klaim turunan SKP Nasional.
 * Fase 4: jendela status item terkunci sesudah klaim diajukan. Fase 5:
 * Accept Finance atas item terkunci.
 *
 * Murni, tanpa I/O — pemanggil mengambil baris akun dari database lalu
 * meneruskannya ke sini. Trigger database
 * `claim_document_type_uploaders_guard` menjadi pengaman cadangan untuk
 * aturan "siapa yang boleh ditunjuk"; fungsi `claim_document_is_locked` dan
 * `is_claim_document_special_uploader` (migrasi 083) adalah padanan aturan
 * item terkunci di lapis RLS.
 */

import {
  DISTRIBUTOR_GUARD_MESSAGES,
  type DistributorGuardDenial,
} from "@/lib/distributor-campaign-guard";
import type { DistributorScope, UserRole } from "@/types/database";

export const SPECIAL_UPLOADER_MESSAGES = {
  notCandidate:
    "Pengunggah khusus harus akun distributor aktif bercakupan Pusat.",
  allInactive:
    "Semua pengunggah khusus nonaktif — aturan sedang tidak berlaku, cabang mengunggah sendiri.",
  uploadedByPusat:
    "Dokumen ini diunggah oleh Pusat — hanya pengunggah khusus yang ditunjuk yang dapat mengunggahnya.",
  manualCheckLocked:
    "Dokumen ini diunggah oleh Pusat — centangnya mengikuti file dan tidak dapat diubah manual.",
  itemAccepted:
    "Dokumen ini sudah di-Accept Finance dan tidak dapat diubah lagi.",
  statusClosed:
    "Dokumen ini hanya dapat diunggah atau dihapus saat SKP berstatus Disetujui, Berjalan, atau Klaim Diajukan.",
  awaitingPusat:
    "Dokumen ini masih ditunggu dari Pusat — belum ada file yang diunggah, jadi belum dapat di-Accept.",
} as const;

export type SpecialUploaderAccount = {
  id: string;
  role: UserRole;
  is_active: boolean;
  distributor_id: string | null;
  distributor_scope: DistributorScope | null;
};

/** Boleh DITUNJUK sebagai pengunggah khusus: distributor aktif bercakupan Pusat. */
export function isSpecialUploaderCandidate(account: SpecialUploaderAccount): boolean {
  return (
    account.role === "distributor" &&
    account.is_active &&
    account.distributor_id !== null &&
    account.distributor_scope === "pusat"
  );
}

/**
 * Penunjukan DIHITUNG: akun masih distributor aktif dengan perusahaan. Akun
 * yang dinonaktifkan tidak pernah dihitung, sehingga menonaktifkan akun tidak
 * diam-diam mengunci dokumen di semua SKP.
 */
export function isActiveSpecialUploader(
  account: Pick<SpecialUploaderAccount, "role" | "is_active" | "distributor_id">
): boolean {
  return account.role === "distributor" && account.is_active && account.distributor_id !== null;
}

/**
 * Ada yang ditunjuk tetapi tidak satu pun dihitung → aturan sedang tidak
 * berlaku. Tanpa penunjukan sama sekali bukan kondisi peringatan.
 */
export function allSpecialUploadersInactive(
  appointed: Pick<SpecialUploaderAccount, "role" | "is_active" | "distributor_id">[]
): boolean {
  return appointed.length > 0 && !appointed.some(isActiveSpecialUploader);
}

export type SpecialUploaderPlan =
  | { toAdd: string[]; toRemove: string[] }
  | { error: string };

/**
 * Selisih antara penunjukan saat ini dan pilihan admin. Hanya akun yang BARU
 * ditambahkan yang divalidasi: akun yang sudah ditunjuk lalu dinonaktifkan
 * boleh tetap tercatat (tidak dihitung) sampai admin mencabutnya.
 *
 * `accounts` = baris akun untuk ID yang baru dipilih; ID tanpa baris dianggap
 * tidak ditemukan dan ditolak.
 */
export function planSpecialUploaderChanges(input: {
  currentIds: string[];
  selectedIds: string[];
  accounts: SpecialUploaderAccount[];
}): SpecialUploaderPlan {
  const current = new Set(input.currentIds);
  const selected = new Set(input.selectedIds);
  const byId = new Map(input.accounts.map((a) => [a.id, a]));

  const toAdd = [...selected].filter((id) => !current.has(id));
  for (const id of toAdd) {
    const account = byId.get(id);
    if (!account || !isSpecialUploaderCandidate(account)) {
      return { error: SPECIAL_UPLOADER_MESSAGES.notCandidate };
    }
  }

  return { toAdd, toRemove: [...current].filter((id) => !selected.has(id)) };
}

// ============================================================
// Pengunggah khusus efektif & item terkunci (Fase 2)
//
// Untuk (SKP, jenis dokumen), pengunggah khusus EFEKTIF = akun yang ditunjuk,
// dihitung (distributor aktif berperusahaan), dan perusahaannya sama dengan
// perusahaan SKP atau perusahaan INDUK dari perusahaan SKP.
//
// - Daftar efektif tidak kosong → item TERKUNCI: hanya akun dalam daftar (dan
//   admin/superadmin) yang boleh mengunggah; centang hanya mengikuti file.
// - Daftar efektif kosong → aturan lama berlaku apa adanya. Semua fungsi di
//   bawah mengembalikan "tidak ada pendapat" (null / false) untuk kasus ini.
//
// Fungsi-fungsi ini MELENGKAPI modul akses distributor
// (lib/distributor-campaign-guard.ts) — pemanggil tetap memeriksa akses SKP,
// status, dan pemegang klaim seperti biasa.
// ============================================================

export type AppointedUploader = Pick<
  SpecialUploaderAccount,
  "id" | "role" | "is_active" | "distributor_id"
>;

export type SpecialUploaderCampaign = {
  distributor_id: string | null;
  /** Induk perusahaan SKP (`distributors.parent_distributor_id`). */
  distributor_parent_id?: string | null;
};

export type SpecialDocumentActor = { id: string; role: string };

function isAdminRole(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

/** ID akun pengunggah khusus efektif sebuah jenis dokumen pada sebuah SKP. */
export function effectiveSpecialUploaderIds(
  campaign: SpecialUploaderCampaign,
  appointed: AppointedUploader[]
): string[] {
  if (!campaign.distributor_id) return [];
  return appointed
    .filter(
      (a) =>
        isActiveSpecialUploader(a) &&
        (a.distributor_id === campaign.distributor_id ||
          (!!campaign.distributor_parent_id &&
            a.distributor_id === campaign.distributor_parent_id))
    )
    .map((a) => a.id);
}

/**
 * Pesan penolakan upload untuk item terkunci, atau null jika modul ini tidak
 * menolak (item tidak terkunci, akun pengunggah khusus efektif, atau admin).
 */
export function specialDocumentUploadError(
  actor: SpecialDocumentActor,
  effectiveUploaderIds: string[]
): string | null {
  if (effectiveUploaderIds.length === 0) return null;
  if (isAdminRole(actor.role)) return null;
  if (effectiveUploaderIds.includes(actor.id)) return null;
  return SPECIAL_UPLOADER_MESSAGES.uploadedByPusat;
}

/**
 * Pesan penolakan centang manual, atau null jika boleh. Item terkunci tidak
 * bisa dicentang manual oleh siapa pun — termasuk pengunggah khususnya.
 */
export function specialDocumentManualCheckError(effectiveUploaderIds: string[]): string | null {
  return effectiveUploaderIds.length > 0 ? SPECIAL_UPLOADER_MESSAGES.manualCheckLocked : null;
}

/**
 * true = akun boleh menghapus file item terkunci walaupun bukan pengunggahnya
 * (admin/superadmin, jalan terakhir). Selain itu aturan hapus lama berlaku:
 * hanya pengunggah file itu sendiri.
 */
export function specialDocumentDeleteOverride(
  actor: SpecialDocumentActor,
  effectiveUploaderIds: string[]
): boolean {
  return effectiveUploaderIds.length > 0 && isAdminRole(actor.role);
}

// ============================================================
// Jangkauan lintas perusahaan (Fase 3)
//
// Pengunggah khusus efektif boleh mengunggah / menghapus dokumen terkuncinya
// di SKP yang selebihnya HANYA BISA IA LIHAT: SKP anak perusahaan dan klaim
// turunan SKP Nasional milik akun lain. Ia tidak mendapat aksi lain di sana —
// modul akses distributor tidak diubah; hasilnya (alasan penolakan aksi)
// menjadi masukan di sini.
//
// Tidak pernah: SKP induk nasional, klaim turunan yang dibatalkan, SKP yang
// tidak terlihat (perusahaan / region lain, klaim milik akun lain tanpa hak
// lihat). Padanan RLS: claim_document_special_upload_reach (migrasi 084).
// ============================================================

/** Alasan "hanya lihat" yang tidak menghalangi pengunggah khusus efektif. */
const SPECIAL_UPLOADER_REACHABLE_DENIALS: readonly DistributorGuardDenial[] = [
  "parentViewOnly",
  "childClaimViewOnly",
];

/**
 * Pesan penolakan bila pengunggah khusus efektif tidak menjangkau SKP ini,
 * atau null jika terjangkau. `denial` = hasil distributorActionDenial untuk
 * akun itu (dihitung dengan induk perusahaan SKP). Hanya untuk akun yang
 * sudah dipastikan pengunggah khusus efektif; akun lain memakai aturan akses
 * biasa.
 */
export function specialUploaderReachError(
  denial: DistributorGuardDenial | null,
  campaign: { parent_campaign_id?: string | null; status?: string | null }
): string | null {
  // Turunan yang dibatalkan: pusat non-pemilik tetap "hanya lihat klaim akun
  // lain" menurut modul akses, jadi statusnya diperiksa di sini.
  if (campaign.parent_campaign_id && campaign.status === "cancelled") {
    return DISTRIBUTOR_GUARD_MESSAGES.claimCancelled;
  }
  if (denial === null || SPECIAL_UPLOADER_REACHABLE_DENIALS.includes(denial)) return null;
  return DISTRIBUTOR_GUARD_MESSAGES[denial];
}

// ============================================================
// Jendela status item terkunci (Fase 4)
//
// Bagi yang BOLEH mengunggah item terkunci (pengunggah khusus efektif, atau
// admin/superadmin), upload / ganti / hapus file terbuka saat SKP Disetujui
// atau Berjalan, dan saat Klaim Diajukan selama item verifikasi dokumen itu
// BELUM Accept — masih kosong, menunggu diperiksa, maupun diminta revisi.
// Kunci pemegang klaim tidak berlaku di sini. Begitu Finance Accept, atau
// status SKP melewati Klaim Diajukan, item tertutup.
//
// Item tidak terkunci tidak memakai fungsi ini — aturan lama (hanya pemegang
// klaim, hanya saat diminta revisi) tetap berlaku. Padanan RLS:
// claim_document_special_upload_open (migrasi 085).
// ============================================================

/**
 * Pesan penolakan upload / hapus file item terkunci menurut status, atau null
 * jika jendelanya terbuka. `itemStatus` = status baris claim_item_verifications
 * dokumen itu (null bila belum ada barisnya).
 */
export function specialDocumentWindowError(
  campaignStatus: string | null | undefined,
  itemStatus: string | null | undefined
): string | null {
  if (campaignStatus === "approved" || campaignStatus === "ongoing") return null;
  if (campaignStatus === "claim_submitted") {
    return itemStatus === "accepted" ? SPECIAL_UPLOADER_MESSAGES.itemAccepted : null;
  }
  return SPECIAL_UPLOADER_MESSAGES.statusClosed;
}

// ============================================================
// Verifikasi Finance (Fase 5)
//
// Item terkunci tidak bisa dicentang manual dan tidak menahan Submit Klaim,
// jadi klaim bisa sampai ke Finance dengan item itu masih kosong. Finance
// tidak boleh meng-Accept-nya sebelum filenya ada — file siapa pun dihitung,
// termasuk unggahan lama cabang. Minta Revisi tetap boleh kapan saja, dan
// aturan Accept item tidak terkunci tidak diubah.
// ============================================================

/**
 * Pesan penolakan Accept untuk item dokumen terkunci yang belum punya file,
 * atau null jika modul ini tidak menolak. `fileCount` = jumlah file jenis
 * dokumen itu di SKP.
 */
export function specialDocumentAcceptError(
  effectiveUploaderIds: string[],
  fileCount: number
): string | null {
  if (effectiveUploaderIds.length === 0) return null;
  return fileCount > 0 ? null : SPECIAL_UPLOADER_MESSAGES.awaitingPusat;
}

/** Ringkasan untuk tampilan satu baris dokumen klaim. */
export type SpecialDocumentAccess = {
  /** Item punya pengunggah khusus efektif pada SKP ini. */
  locked: boolean;
  /**
   * Akun ini termasuk yang boleh mengunggah item terkunci DAN menjangkau SKP
   * ini — bisa true walaupun akses SKP-nya hanya lihat (Fase 3).
   */
  canUpload: boolean;
  /** Akun ini boleh menghapus file siapa pun pada item terkunci (admin). */
  canDeleteAny: boolean;
};

/**
 * `reachError` = hasil specialUploaderReachError untuk akun distributor ini
 * (diabaikan untuk admin/superadmin, yang selalu menjangkau).
 */
export function specialDocumentAccess(
  actor: SpecialDocumentActor,
  effectiveUploaderIds: string[],
  reachError: string | null = null
): SpecialDocumentAccess {
  const locked = effectiveUploaderIds.length > 0;
  const reaches = isAdminRole(actor.role) || reachError === null;
  return {
    locked,
    canUpload:
      locked && reaches && specialDocumentUploadError(actor, effectiveUploaderIds) === null,
    canDeleteAny: specialDocumentDeleteOverride(actor, effectiveUploaderIds),
  };
}

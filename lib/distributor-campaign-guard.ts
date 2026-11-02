/**
 * Modul akses distributor terhadap SKP (Multi-User Distributor, Fase 1, 3 & 6).
 * Satu sumber kebenaran di sisi aplikasi untuk dua pertanyaan:
 *
 * - **Boleh lihat?** — daftar SKP, detail (termasuk URL langsung), file,
 *   riwayat klaim, Rekap, export.
 * - **Boleh bertindak?** — submit/batal klaim, ubah nominal klaim, upload
 *   dokumen klaim, centang checklist, tandai diterima.
 *
 * Aturan (keputusan PRD, prd-multi-user-distributor.md):
 * - Akun distributor tanpa perusahaan tidak melihat dan tidak bisa bertindak
 *   atas apa pun.
 * - Perusahaan sama + scope `pusat`  → bertindak, semua region.
 * - Perusahaan sama + scope `cabang` → bertindak hanya di region akun.
 *   Scope null (akun lama) diperlakukan sebagai cabang.
 * - Scope `pusat` dari perusahaan INDUK SKP → **hanya lihat**.
 * - SKP tanpa perusahaan tidak terlihat dan tidak bisa dikerjakan oleh
 *   distributor mana pun (Fase 6; pengecualian sementara sudah dicabut).
 * - Admin/superadmin selalu boleh bertindak (fallback).
 *
 * Padanannya di database: fungsi `distributor_campaign_access` (migrasi 067,
 * diperbarui 069)
 * yang dipakai semua policy RLS tabel terkait klaim. Status dan departemen
 * SKP (Sales/TM, Disetujui s.d. Selesai) disaring oleh RLS +
 * DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES, bukan oleh modul ini.
 *
 * Murni, tanpa I/O — pemanggil menyediakan kolom SKP dan profil akun.
 */

import type { DistributorScope } from "@/types/database";

export const DISTRIBUTOR_GUARD_MESSAGES = {
  noCompany: "Akun Anda belum terhubung ke perusahaan distributor",
  otherCompany: "SKP ini bukan milik distributor Anda",
  otherRegion: "SKP ini di luar region akun Anda",
  parentViewOnly: "Hanya lihat — SKP anak perusahaan",
} as const;

export type DistributorGuardDenial = keyof typeof DISTRIBUTOR_GUARD_MESSAGES;

/** "act" = boleh lihat & bertindak, "view" = hanya lihat, null = tidak terlihat. */
export type DistributorCampaignAccess = "act" | "view" | null;

export type DistributorViewer = {
  role: string;
  distributor_id: string | null;
  distributor_scope?: DistributorScope | null;
  region_id?: string | null;
};

export type CampaignAccessTarget = {
  distributor_id: string | null;
  region_id: string | null;
  /** Induk perusahaan SKP (`distributors.parent_distributor_id`); opsional. */
  distributor_parent_id?: string | null;
};

function isAdminRole(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

function regionMatches(campaign: CampaignAccessTarget, viewer: DistributorViewer): boolean {
  if (viewer.distributor_scope === "pusat") return true;
  return !!campaign.region_id && !!viewer.region_id && campaign.region_id === viewer.region_id;
}

/**
 * Alasan akun distributor tidak boleh bertindak, atau null jika boleh.
 * Admin/superadmin selalu null.
 */
export function distributorActionDenial(
  campaign: CampaignAccessTarget,
  viewer: DistributorViewer
): DistributorGuardDenial | null {
  if (isAdminRole(viewer.role)) return null;
  if (!viewer.distributor_id) return "noCompany";

  // SKP tanpa perusahaan bukan milik siapa pun (Fase 6).
  if (!campaign.distributor_id) return "otherCompany";

  if (campaign.distributor_id === viewer.distributor_id) {
    return regionMatches(campaign, viewer) ? null : "otherRegion";
  }

  if (
    viewer.distributor_scope === "pusat" &&
    campaign.distributor_parent_id &&
    campaign.distributor_parent_id === viewer.distributor_id
  ) {
    return "parentViewOnly";
  }

  return "otherCompany";
}

/** Tingkat akses akun terhadap SKP: bertindak, hanya lihat, atau tidak terlihat. */
export function distributorCampaignAccess(
  campaign: CampaignAccessTarget,
  viewer: DistributorViewer
): DistributorCampaignAccess {
  const denial = distributorActionDenial(campaign, viewer);
  if (denial === null) return "act";
  if (denial === "parentViewOnly") return "view";
  return null;
}

/**
 * Pesan error ramah untuk server action / route aksi klaim, atau null jika
 * aksi boleh dilanjutkan. Role selain admin/superadmin diperlakukan sebagai
 * distributor (pemanggil sudah memfilter role yang boleh memanggil aksi).
 */
export function distributorClaimActionError(
  viewer: DistributorViewer,
  campaign: CampaignAccessTarget
): string | null {
  const denial = distributorActionDenial(campaign, viewer);
  return denial ? DISTRIBUTOR_GUARD_MESSAGES[denial] : null;
}

// ============================================================
// Pemegang klaim (Fase 9)
//
// Akun yang menekan Submit Klaim (`campaigns.claim_submitted_by`) menjadi
// pemegang klaim. Selama SKP berstatus `claim_submitted`, aksi berikut hanya
// untuk pemegang klaim (dan admin/superadmin sebagai fallback): batal klaim,
// ubah nominal, upload dokumen revisi, hapus file. Sebelum klaim diajukan
// belum ada pemegang — semua akun yang boleh bertindak bisa bekerja bersama.
// File hanya bisa dihapus oleh pengunggahnya, sebelum maupun sesudah submit.
//
// Aturan ini melengkapi distributorClaimActionError (perusahaan/region),
// bukan menggantikannya — pemanggil memeriksa keduanya.
// ============================================================

export const CLAIM_HOLDER_MESSAGES = {
  notHolder:
    "Klaim ini dipegang oleh akun lain — hanya pemegang klaim yang dapat melakukan aksi ini",
  notUploader: "Hanya pengunggah yang dapat menghapus file ini",
} as const;

export type ClaimActor = { id: string; role: string };

export type ClaimHolderTarget = {
  status: string;
  claim_submitted_by: string | null;
};

/**
 * Pesan error jika aksi khusus pemegang klaim ditolak, atau null jika boleh.
 * Hanya berlaku saat status `claim_submitted`; klaim diajukan tanpa pemegang
 * tercatat (akun pemegang terhapus) hanya bisa ditangani admin.
 */
export function claimHolderActionError(
  actor: ClaimActor,
  claim: ClaimHolderTarget
): string | null {
  if (isAdminRole(actor.role)) return null;
  if (claim.status !== "claim_submitted") return null;
  if (claim.claim_submitted_by && claim.claim_submitted_by === actor.id) return null;
  return CLAIM_HOLDER_MESSAGES.notHolder;
}

/** true = aksi khusus pemegang klaim disembunyikan/ditolak untuk akun ini. */
export function isClaimHolderLocked(actor: ClaimActor, claim: ClaimHolderTarget): boolean {
  return claimHolderActionError(actor, claim) !== null;
}

/**
 * Pesan error jika akun tidak boleh menghapus file dokumen klaim, atau null
 * jika boleh: harus pengunggahnya (admin juga), dan selama klaim diajukan
 * pengunggah itu harus pemegang klaim.
 */
export function claimFileDeleteError(
  actor: ClaimActor,
  file: { uploaded_by: string | null },
  claim: ClaimHolderTarget
): string | null {
  if (!file.uploaded_by || file.uploaded_by !== actor.id) return CLAIM_HOLDER_MESSAGES.notUploader;
  return claimHolderActionError(actor, claim);
}

// ============================================================
// Alihkan pemegang klaim (Fase 10)
//
// Hanya admin/superadmin, hanya saat SKP berstatus `claim_submitted`.
// Pemegang baru harus akun distributor aktif dari perusahaan SKP itu sendiri
// (bukan perusahaan induk) dan bukan pemegang saat ini. Pengalihan tidak
// mengubah status SKP maupun status verifikasi Finance per item.
// ============================================================

export const CLAIM_HOLDER_TRANSFER_MESSAGES = {
  notAdmin: "Hanya admin yang dapat mengalihkan pemegang klaim",
  notSubmitted: "Pemegang klaim hanya dapat dialihkan saat SKP berstatus Klaim Diajukan",
  noCompany: "SKP ini belum terhubung ke perusahaan distributor",
  candidateNotFound: "Akun pemegang baru tidak ditemukan",
  candidateNotDistributor: "Pemegang baru harus akun distributor",
  candidateInactive: "Akun pemegang baru tidak aktif",
  candidateOtherCompany: "Pemegang baru harus dari perusahaan distributor SKP ini",
  sameHolder: "Akun tersebut sudah menjadi pemegang klaim",
} as const;

export type ClaimHolderTransferTarget = ClaimHolderTarget & {
  distributor_id: string | null;
};

export type ClaimHolderCandidate = {
  id: string;
  role: string;
  is_active: boolean;
  distributor_id: string | null;
};

/** true = akun ini boleh dipilih sebagai pemegang klaim baru untuk SKP ini. */
export function isClaimHolderCandidate(
  candidate: ClaimHolderCandidate,
  claim: ClaimHolderTransferTarget
): boolean {
  return (
    candidate.role === "distributor" &&
    candidate.is_active &&
    !!claim.distributor_id &&
    candidate.distributor_id === claim.distributor_id &&
    candidate.id !== claim.claim_submitted_by
  );
}

/** Pesan error jika pengalihan ditolak, atau null jika boleh. */
export function claimHolderTransferError(
  actor: ClaimActor,
  claim: ClaimHolderTransferTarget,
  candidate: ClaimHolderCandidate | null
): string | null {
  const m = CLAIM_HOLDER_TRANSFER_MESSAGES;
  if (!isAdminRole(actor.role)) return m.notAdmin;
  if (claim.status !== "claim_submitted") return m.notSubmitted;
  if (!claim.distributor_id) return m.noCompany;
  if (!candidate) return m.candidateNotFound;
  if (candidate.role !== "distributor") return m.candidateNotDistributor;
  if (!candidate.is_active) return m.candidateInactive;
  if (candidate.distributor_id !== claim.distributor_id) return m.candidateOtherCompany;
  if (candidate.id === claim.claim_submitted_by) return m.sameHolder;
  return null;
}

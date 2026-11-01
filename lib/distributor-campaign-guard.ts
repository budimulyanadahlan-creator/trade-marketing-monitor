/**
 * Modul akses distributor terhadap SKP (Multi-User Distributor, Fase 1 & 3).
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
 * - SKP tanpa perusahaan: SEMENTARA (sampai Fase 6) diperlakukan seperti SKP
 *   perusahaan akun sendiri — cabang di region yang sama / pusat semua
 *   region boleh bertindak.
 * - Admin/superadmin selalu boleh bertindak (fallback).
 *
 * Padanannya di database: fungsi `distributor_campaign_access` (migrasi 067)
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

  // Perusahaan sama, atau SKP belum punya perusahaan (sementara).
  if (!campaign.distributor_id || campaign.distributor_id === viewer.distributor_id) {
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

/**
 * Pengaman aksi klaim distributor per perusahaan (Multi-User Distributor,
 * Fase 1). Satu sumber kebenaran untuk semua aksi klaim yang dilakukan akun
 * distributor: submit klaim, batal klaim, ubah nominal klaim, upload dokumen
 * klaim, centang checklist, dan tandai diterima.
 *
 * Aturan:
 * - Akun distributor tanpa perusahaan (`users.distributor_id` null) ditolak
 *   untuk semua aksi, termasuk pada SKP yang belum punya perusahaan.
 * - SKP yang sudah punya perusahaan hanya boleh dikerjakan akun dari
 *   perusahaan yang sama.
 * - SKP tanpa perusahaan masih boleh dikerjakan akun yang punya perusahaan
 *   (pengecualian sementara sampai backfill distributor selesai; dicabut di
 *   Fase 6).
 * - Admin/superadmin tidak terpengaruh (fallback).
 *
 * Latar: insiden akun tes tanpa perusahaan yang mencentang checklist SKP
 * perusahaan lain, lalu 25 akun cabang EDM/MMS/BIR aktif 2026-10-30 yang
 * sebelum fase ini bisa mengajukan/membatalkan klaim SKP perusahaan lain.
 *
 * Murni, tanpa I/O — pemanggil mengambil `campaign.distributor_id` dan
 * `users.distributor_id` + `users.role` akun yang bertindak, lalu
 * meneruskannya ke sini.
 */

export const DISTRIBUTOR_GUARD_MESSAGES = {
  noCompany: "Akun Anda belum terhubung ke perusahaan distributor",
  otherCompany: "SKP ini bukan milik distributor Anda",
} as const;

export type DistributorGuardDenial = keyof typeof DISTRIBUTOR_GUARD_MESSAGES;

/**
 * Alasan penolakan untuk akun distributor, atau null jika boleh bertindak.
 * Tidak memeriksa role — lihat `distributorClaimActionError` untuk itu.
 */
export function distributorGuardDenial(
  campaignDistributorId: string | null,
  userDistributorId: string | null
): DistributorGuardDenial | null {
  if (!userDistributorId) return "noCompany";
  if (!campaignDistributorId) return null;
  return campaignDistributorId === userDistributorId ? null : "otherCompany";
}

/**
 * Apakah akun distributor boleh bertindak atas SKP ini. Bentuk boolean dari
 * `distributorGuardDenial` untuk keputusan UI (misalnya tautan SKP di
 * halaman event bisa dibuka atau tidak).
 */
export function isDistributorAllowedOnCampaign(
  campaignDistributorId: string | null,
  userDistributorId: string | null
): boolean {
  return distributorGuardDenial(campaignDistributorId, userDistributorId) === null;
}

/**
 * Pesan error ramah untuk server action / route aksi klaim, atau null jika
 * aksi boleh dilanjutkan. Admin dan superadmin selalu lolos; role lain
 * diperlakukan sebagai distributor (pemanggil sudah memfilter role yang
 * boleh memanggil aksi tersebut).
 */
export function distributorClaimActionError(
  role: string,
  userDistributorId: string | null,
  campaignDistributorId: string | null
): string | null {
  if (role === "admin" || role === "superadmin") return null;
  const denial = distributorGuardDenial(campaignDistributorId, userDistributorId);
  return denial ? DISTRIBUTOR_GUARD_MESSAGES[denial] : null;
}

/**
 * Pengunggah khusus dokumen klaim (plans/prd-pengunggah-khusus-dokumen-klaim.md).
 *
 * Admin menunjuk satu atau lebih akun distributor bercakupan Pusat sebagai
 * pengunggah khusus sebuah jenis dokumen klaim (tabel
 * `claim_document_type_uploaders`, migrasi 082). Modul ini adalah sumber
 * kebenaran sisi aplikasi untuk aturan penunjukan itu.
 *
 * Fase 1 hanya memuat aturan penunjukan (siapa yang boleh ditunjuk, kapan
 * penunjukan dihitung). Aturan upload/hapus/centang menyusul di fase 2.
 *
 * Murni, tanpa I/O — pemanggil mengambil baris akun dari database lalu
 * meneruskannya ke sini. Trigger database
 * `claim_document_type_uploaders_guard` menjadi pengaman cadangan untuk
 * aturan "siapa yang boleh ditunjuk".
 */

import type { DistributorScope, UserRole } from "@/types/database";

export const SPECIAL_UPLOADER_MESSAGES = {
  notCandidate:
    "Pengunggah khusus harus akun distributor aktif bercakupan Pusat.",
  allInactive:
    "Semua pengunggah khusus nonaktif — aturan sedang tidak berlaku, cabang mengunggah sendiri.",
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

/**
 * Validasi perusahaan induk distributor (Multi-User Distributor, Fase 2).
 *
 * Aturan (keputusan PRD): hierarki maksimal satu tingkat.
 * - Perusahaan tidak boleh menunjuk dirinya sendiri sebagai induk.
 * - Induk yang dipilih tidak boleh punya induk lagi (cucu dilarang).
 * - Perusahaan yang sudah menjadi induk perusahaan lain tidak boleh diberi
 *   induk. Dua aturan terakhir sekaligus mencegah siklus.
 *
 * Murni, tanpa I/O — pemanggil mengambil baris induk dan status "punya anak"
 * dari database, lalu meneruskannya ke sini. Trigger database
 * `distributors_guard_parent` menjadi pengaman cadangan dengan aturan yang sama.
 */

export const DISTRIBUTOR_PARENT_MESSAGES = {
  self: "Perusahaan induk tidak boleh perusahaan itu sendiri.",
  notFound: "Perusahaan induk tidak ditemukan.",
  twoLevels:
    "Perusahaan induk yang dipilih sudah punya induk. Hierarki maksimal satu tingkat.",
  hasChildren:
    "Perusahaan ini sudah menjadi induk perusahaan lain, jadi tidak bisa diberi induk.",
} as const;

export type DistributorParentInput = {
  /** ID perusahaan yang sedang disimpan; null saat membuat baru. */
  selfId: string | null;
  /** ID induk yang dipilih; null/"" jika tidak ada induk. */
  parentId: string | null;
  /** Baris induk dari database; null jika tidak ditemukan. */
  parent: { id: string; parent_distributor_id: string | null } | null;
  /** Apakah perusahaan yang disimpan sudah menjadi induk perusahaan lain. */
  hasChildren: boolean;
};

/** Pesan error ramah, atau null jika pilihan induk sah. */
export function distributorParentError(input: DistributorParentInput): string | null {
  const { selfId, parentId, parent, hasChildren } = input;
  if (!parentId) return null;
  if (selfId && parentId === selfId) return DISTRIBUTOR_PARENT_MESSAGES.self;
  if (!parent) return DISTRIBUTOR_PARENT_MESSAGES.notFound;
  if (hasChildren) return DISTRIBUTOR_PARENT_MESSAGES.hasChildren;
  if (parent.parent_distributor_id) return DISTRIBUTOR_PARENT_MESSAGES.twoLevels;
  return null;
}

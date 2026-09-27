// Foto item POSM, asset, dan bukti penempatan (fase 8). Satu foto per record,
// disimpan di bucket posm-photos (migrasi 048). Tipe gambar sama dengan
// upload file SKP.

export const POSM_PHOTO_BUCKET = "posm-photos";
// Di bawah batas body request Vercel (4,5 MB) agar request upload tidak
// ditolak Vercel sebelum sampai ke route. Satuan desimal (bukan MiB) supaya
// tetap aman apa pun definisi "MB" yang dipakai Vercel.
export const POSM_PHOTO_MAX_SIZE = 4_400_000;
export const POSM_PHOTO_MAX_LABEL = "4,4 MB";
export const POSM_PHOTO_TYPES = ["image/jpeg", "image/jpg", "image/png"];
/** Untuk atribut accept pada input file. */
export const POSM_PHOTO_ACCEPT = "image/jpeg,image/png";

export const POSM_PHOTO_TABLES = {
  item: "posm_items",
  asset: "marketing_assets",
  placement: "asset_placements",
} as const;

export type PosmPhotoKind = keyof typeof POSM_PHOTO_TABLES;
export type PosmPhotoTable = (typeof POSM_PHOTO_TABLES)[PosmPhotoKind];

/** Pesan error jika file tidak bisa dipakai sebagai foto, atau null. */
export function validatePosmPhoto(file: { type: string; size: number }): string | null {
  if (!POSM_PHOTO_TYPES.includes(file.type)) return "Format foto tidak didukung. Gunakan JPG atau PNG.";
  if (file.size > POSM_PHOTO_MAX_SIZE) return `Ukuran foto maksimal ${POSM_PHOTO_MAX_LABEL}.`;
  return null;
}

export function parsePosmPhotoKind(kind: unknown): PosmPhotoTable | null {
  return typeof kind === "string" && Object.hasOwn(POSM_PHOTO_TABLES, kind)
    ? POSM_PHOTO_TABLES[kind as PosmPhotoKind]
    : null;
}

/** Foto selalu dikompres ulang menjadi JPEG, jadi ekstensinya .jpg. */
export function posmPhotoPath(kind: PosmPhotoKind, recordId: string, now: number): string {
  return `${kind}/${recordId}/${now}.jpg`;
}

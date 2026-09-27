// Foto item POSM, asset, dan bukti penempatan (fase 8), serta foto item
// gimmick dan bukti serah terima Keluar gimmick. Satu foto per record. Foto
// POSM/asset di bucket posm-photos (migrasi 048); foto gimmick di bucket
// terpisah gimmick-photos (migrasi 053) yang hanya terbaca can_manage_posm().
// Tipe gambar sama dengan upload file SKP.

export const POSM_PHOTO_BUCKET = "posm-photos";
export const GIMMICK_PHOTO_BUCKET = "gimmick-photos";
import { UPLOAD_MAX_LABEL, UPLOAD_MAX_SIZE } from "./upload-limits";

export const POSM_PHOTO_MAX_SIZE = UPLOAD_MAX_SIZE;
export const POSM_PHOTO_MAX_LABEL = UPLOAD_MAX_LABEL;
export const POSM_PHOTO_TYPES = ["image/jpeg", "image/jpg", "image/png"];
/** Untuk atribut accept pada input file. */
export const POSM_PHOTO_ACCEPT = "image/jpeg,image/png";

export const POSM_PHOTO_TARGETS = {
  item: { table: "posm_items", bucket: POSM_PHOTO_BUCKET },
  asset: { table: "marketing_assets", bucket: POSM_PHOTO_BUCKET },
  placement: { table: "asset_placements", bucket: POSM_PHOTO_BUCKET },
  gimmick_item: { table: "gimmick_items", bucket: GIMMICK_PHOTO_BUCKET },
  gimmick_movement: { table: "gimmick_movements", bucket: GIMMICK_PHOTO_BUCKET },
} as const;

export type PosmPhotoKind = keyof typeof POSM_PHOTO_TARGETS;
export type PosmPhotoTarget = (typeof POSM_PHOTO_TARGETS)[PosmPhotoKind];
export type PosmPhotoTable = PosmPhotoTarget["table"];

/** Pesan error jika file tidak bisa dipakai sebagai foto, atau null. */
export function validatePosmPhoto(file: { type: string; size: number }): string | null {
  if (!POSM_PHOTO_TYPES.includes(file.type)) return "Format foto tidak didukung. Gunakan JPG atau PNG.";
  if (file.size > POSM_PHOTO_MAX_SIZE) return `Ukuran foto maksimal ${POSM_PHOTO_MAX_LABEL}.`;
  return null;
}

export function parsePosmPhotoKind(kind: unknown): PosmPhotoTarget | null {
  return typeof kind === "string" && Object.hasOwn(POSM_PHOTO_TARGETS, kind)
    ? POSM_PHOTO_TARGETS[kind as PosmPhotoKind]
    : null;
}

/** Foto selalu dikompres ulang menjadi JPEG, jadi ekstensinya .jpg. */
export function posmPhotoPath(kind: PosmPhotoKind, recordId: string, now: number): string {
  return `${kind}/${recordId}/${now}.jpg`;
}

/**
 * Aturan ganti password mandiri (Multi-User Distributor, Fase 4).
 *
 * Murni, tanpa I/O. Dipakai server action `changePasswordAction` dan form
 * /ganti-password agar pesan validasi di klien dan server identik.
 * Pengecekan password lama yang benar dilakukan pemanggil lewat Supabase Auth.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_CHANGE_MESSAGES = {
  currentRequired: "Password lama harus diisi.",
  tooShort: `Password baru minimal ${PASSWORD_MIN_LENGTH} karakter.`,
  sameAsCurrent: "Password baru harus berbeda dari password lama.",
  confirmMismatch: "Konfirmasi password tidak cocok dengan password baru.",
  currentWrong: "Password lama salah.",
} as const;

export type PasswordChangeInput = {
  currentPassword: string | null | undefined;
  newPassword: string | null | undefined;
  confirmPassword: string | null | undefined;
};

/** Pesan error ramah, atau null jika input sah. */
export function passwordChangeError(input: PasswordChangeInput): string | null {
  const current = input.currentPassword ?? "";
  const next = input.newPassword ?? "";
  const confirm = input.confirmPassword ?? "";

  if (!current) return PASSWORD_CHANGE_MESSAGES.currentRequired;
  if (next.length < PASSWORD_MIN_LENGTH) return PASSWORD_CHANGE_MESSAGES.tooShort;
  if (next === current) return PASSWORD_CHANGE_MESSAGES.sameAsCurrent;
  if (next !== confirm) return PASSWORD_CHANGE_MESSAGES.confirmMismatch;
  return null;
}

/** Halaman awal sesuai role setelah password berhasil diganti. */
export function postPasswordChangeRedirect(role: string | null | undefined): string {
  return role === "distributor" ? "/campaigns" : "/dashboard";
}

// Batas ukuran semua upload file (dokumen SKP, dokumen klaim, foto POSM).
// Harus di bawah batas body request Vercel (4,5 MB): request yang lebih besar
// ditolak Vercel sebelum sampai ke route, dengan error yang tidak jelas.
// Satuan desimal (bukan MiB) supaya tetap aman apa pun definisi "MB" Vercel.
// Sama dengan file_size_limit bucket di migrasi 048 & 049.
export const UPLOAD_MAX_SIZE = 4_400_000;
export const UPLOAD_MAX_LABEL = "4,4 MB";

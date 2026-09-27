-- Batas ukuran upload dokumen SKP & klaim diturunkan dari 5 MB ke 4,4 MB
-- (4.400.000 byte) agar di bawah batas body request Vercel 4,5 MB.
-- Sama dengan UPLOAD_MAX_SIZE di lib/upload-limits.ts. Bucket posm-photos
-- sudah memakai batas ini sejak migrasi 048.
update storage.buckets
   set file_size_limit = 4400000
 where id = 'campaign-documents';

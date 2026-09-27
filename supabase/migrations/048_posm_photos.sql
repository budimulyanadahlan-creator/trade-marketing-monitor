-- Monitoring POSM & Asset — Fase 8 (plans/plan-monitoring-posm-asset.md)
-- Bucket foto item POSM, asset, dan bukti penempatan.
-- Satu foto per record, path disimpan di kolom photo_path masing-masing tabel
-- (sudah ada sejak migrasi 043 & 046). Route app/api/posm-photo menulis
-- dengan client milik user, jadi policy di bawah adalah penjaga akhirnya.

-- ============================================================
-- 1. BUCKET
-- ============================================================
-- Tipe gambar sama dengan upload file SKP. Batas 4,4 MB (4.400.000 byte) agar
-- di bawah batas body request Vercel 4,5 MB; sama dengan POSM_PHOTO_MAX_SIZE.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'posm-photos',
  'posm-photos',
  false,
  4400000,
  array['image/jpeg', 'image/png', 'image/jpg']
)
on conflict (id) do nothing;

-- ============================================================
-- 2. POLICY: tulis via can_manage_posm(), baca untuk non-distributor
-- ============================================================
drop policy if exists "posm_photos_select" on storage.objects;
drop policy if exists "posm_photos_insert" on storage.objects;
drop policy if exists "posm_photos_update" on storage.objects;
drop policy if exists "posm_photos_delete" on storage.objects;

create policy "posm_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'posm-photos' and public.is_posm_reader());

create policy "posm_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'posm-photos' and public.can_manage_posm());

create policy "posm_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'posm-photos' and public.can_manage_posm())
  with check (bucket_id = 'posm-photos' and public.can_manage_posm());

create policy "posm_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'posm-photos' and public.can_manage_posm());

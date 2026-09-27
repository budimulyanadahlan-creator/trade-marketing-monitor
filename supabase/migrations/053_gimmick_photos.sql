-- Monitoring Gimmick — Fase 5 (plans/plan-monitoring-gimmick.md)
-- Foto item gimmick dan foto bukti serah terima transaksi Keluar.
-- Satu foto per record, path disimpan di kolom photo_path (sudah ada sejak
-- migrasi 050 & 051). Route app/api/posm-photo menulis dengan client milik
-- user, jadi policy di bawah adalah penjaga akhirnya.
--
-- Bucket sengaja terpisah dari posm-photos: policy baca posm-photos terbuka
-- untuk semua non-distributor (is_posm_reader), sedangkan data gimmick hanya
-- untuk can_manage_posm(). Policy posm-photos tidak diubah.

-- ============================================================
-- 1. BUCKET
-- ============================================================
-- Batas 4,4 MB dan tipe gambar sama dengan posm-photos (migrasi 048).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gimmick-photos',
  'gimmick-photos',
  false,
  4400000,
  array['image/jpeg', 'image/png', 'image/jpg']
)
on conflict (id) do nothing;

-- ============================================================
-- 2. POLICY: baca & tulis hanya can_manage_posm()
-- ============================================================
drop policy if exists "gimmick_photos_select" on storage.objects;
drop policy if exists "gimmick_photos_insert" on storage.objects;
drop policy if exists "gimmick_photos_update" on storage.objects;
drop policy if exists "gimmick_photos_delete" on storage.objects;

create policy "gimmick_photos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'gimmick-photos' and public.can_manage_posm());

create policy "gimmick_photos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gimmick-photos' and public.can_manage_posm());

create policy "gimmick_photos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'gimmick-photos' and public.can_manage_posm())
  with check (bucket_id = 'gimmick-photos' and public.can_manage_posm());

create policy "gimmick_photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'gimmick-photos' and public.can_manage_posm());

-- ============================================================
-- 3. FOTO BUKTI HANYA UNTUK KELUAR
-- ============================================================
alter table public.gimmick_movements
  drop constraint if exists gimmick_movements_photo_out_only;
alter table public.gimmick_movements
  add constraint gimmick_movements_photo_out_only
  check (photo_path is null or type = 'out');

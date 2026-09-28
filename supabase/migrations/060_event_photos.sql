-- Monitoring Event & Activity — Fase 8 (plans/plan-monitoring-event.md)
-- 1. Bucket event-photos (privat, batas ukuran & tipe sama dengan posm-photos)
-- 2. Tabel event_photos (banyak foto per event, soft delete)
-- 3. Batas 10 foto aktif per event (trigger)
-- 4. Audit ke posm_audit_log dengan record_id = event_id
-- 5. RLS event_photos: baca mengikuti events, tulis via can_manage_posm()
-- 6. Storage policy: baca mengikuti aturan baca events, tulis can_manage_posm()
-- Route app/api/event-photo menulis dengan client milik user, jadi policy di
-- bawah adalah penjaga akhirnya. Batas yang sama dicek di aplikasi lewat
-- EVENT_PHOTO_MAX / eventPhotoLimitError (lib/event.ts).

-- ============================================================
-- 1. BUCKET
-- ============================================================
-- Batas 4,4 MB dan tipe gambar sama dengan posm-photos (migrasi 048).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-photos',
  'event-photos',
  false,
  4400000,
  array['image/jpeg', 'image/png', 'image/jpg']
)
on conflict (id) do nothing;

-- ============================================================
-- 2. event_photos
-- ============================================================
-- path = '<event_id>/<timestamp>.jpg' (eventPhotoPath di lib/event.ts);
-- folder pertama dipakai storage policy untuk mencocokkan event.
create table if not exists public.event_photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id),
  path         text not null unique,
  uploaded_by  uuid references public.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint event_photos_path_in_event_folder
    check (split_part(path, '/', 1) = event_id::text)
);

create index if not exists idx_event_photos_event_id
  on public.event_photos (event_id, created_at)
  where deleted_at is null;

-- ============================================================
-- 3. BATAS 10 FOTO
-- ============================================================
-- Baris event dikunci agar dua upload bersamaan tidak sama-sama lolos di
-- foto ke-10. SECURITY DEFINER agar penguncian tidak bergantung RLS events.
create or replace function public.event_photos_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.events
   where id = new.event_id and deleted_at is null
   for update;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: event tidak ditemukan atau sudah dihapus';
  end if;

  if (
    select count(*) from public.event_photos
     where event_id = new.event_id and deleted_at is null
  ) >= 10 then
    raise exception 'FOTO_MAKSIMAL: maksimal 10 foto per event';
  end if;

  return new;
end;
$$;

create trigger event_photos_limit
  before insert on public.event_photos
  for each row execute function public.event_photos_limit();

-- ============================================================
-- 4. AUDIT
-- ============================================================
-- Hapus foto = soft delete (deleted_at), dicatat sebagai soft_delete.
create trigger event_photos_audit
  after insert or update on public.event_photos
  for each row execute function public.event_links_audit_trigger();

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.event_photos enable row level security;

-- Seperti tabel anak lain (migrasi 059): subquery ke events tunduk pada RLS
-- events milik pembaca, sehingga distributor hanya melihat foto event yang
-- boleh dilihatnya. Tidak ada policy delete.
create policy "event_photos_select_reader"
  on public.event_photos for select
  to authenticated
  using (
    (select public.is_posm_reader())
    or exists (select 1 from public.events e where e.id = event_photos.event_id)
  );

create policy "event_photos_insert_writer"
  on public.event_photos for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_photos_update_writer"
  on public.event_photos for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- ============================================================
-- 6. STORAGE POLICY
-- ============================================================
-- Baca: internal, atau distributor jika event di folder pertama terlihat
-- olehnya lewat RLS events (region/distributor, migrasi 059). Path event lain
-- ditolak meskipun diminta langsung.
drop policy if exists "event_photos_storage_select" on storage.objects;
drop policy if exists "event_photos_storage_insert" on storage.objects;
drop policy if exists "event_photos_storage_update" on storage.objects;
drop policy if exists "event_photos_storage_delete" on storage.objects;

create policy "event_photos_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-photos'
    and (
      public.is_posm_reader()
      or exists (
        select 1 from public.events e
         where e.id::text = (storage.foldername(name))[1]
           and e.deleted_at is null
      )
    )
  );

create policy "event_photos_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'event-photos' and public.can_manage_posm());

create policy "event_photos_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'event-photos' and public.can_manage_posm())
  with check (bucket_id = 'event-photos' and public.can_manage_posm());

create policy "event_photos_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'event-photos' and public.can_manage_posm());

-- 082: Pengunggah Khusus Dokumen Klaim — Fase 1
-- (plans/plan-pengunggah-khusus-dokumen-klaim.md)
-- Penunjukan pengunggah khusus di master data.
--
-- Admin/superadmin menunjuk satu atau lebih akun distributor bercakupan Pusat
-- sebagai pengunggah khusus sebuah jenis dokumen klaim. Fase ini hanya
-- menyimpan penunjukannya: belum ada fungsi atau policy alur klaim yang
-- membacanya, jadi perilaku upload/checklist/verifikasi TIDAK berubah.
--
-- Isi:
--   1. Tabel claim_document_type_uploaders: pasangan unik
--      (document_type_id, user_id) + created_by, created_at. Terhapus otomatis
--      bila jenis dokumen atau akunnya dihapus.
--   2. RLS: dibaca semua pengguna terautentikasi (fase berikutnya butuh ini
--      untuk menentukan tampilan baris dokumen), ditulis hanya admin/superadmin
--      aktif. Tidak ada UPDATE — penunjukan hanya ditambah atau dicabut.
--   3. Trigger claim_document_type_uploaders_guard: akun yang ditunjuk harus
--      distributor aktif bercakupan Pusat saat penunjukan dibuat. Akun yang
--      belakangan dinonaktifkan tetap tercatat; ia tidak dihitung oleh aturan
--      "pengunggah khusus efektif" (fase 2).
--
-- Padanan sisi aplikasi: lib/claim-document-uploaders.ts
-- (isSpecialUploaderCandidate).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 1: halaman master data Dokumen
-- Klaim membaca tabel ini. Aman untuk aplikasi lama: belum ada yang membacanya.
-- Prasyarat: migrasi 065 (users.distributor_scope) sudah dijalankan.

-- ============================================================
-- 1. TABEL
-- ============================================================

create table if not exists public.claim_document_type_uploaders (
  id               uuid        primary key default gen_random_uuid(),
  document_type_id uuid        not null references public.claim_document_types(id) on delete cascade,
  user_id          uuid        not null references public.users(id) on delete cascade,
  created_by       uuid        references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (document_type_id, user_id)
);

create index if not exists claim_document_type_uploaders_user_id_idx
  on public.claim_document_type_uploaders (user_id);

-- ============================================================
-- 2. RLS
-- ============================================================

alter table public.claim_document_type_uploaders enable row level security;

drop policy if exists "claim_document_type_uploaders_select" on public.claim_document_type_uploaders;
create policy "claim_document_type_uploaders_select"
  on public.claim_document_type_uploaders for select to authenticated
  using (true);

drop policy if exists "claim_document_type_uploaders_insert" on public.claim_document_type_uploaders;
create policy "claim_document_type_uploaders_insert"
  on public.claim_document_type_uploaders for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin')
        and u.is_active = true
    )
  );

drop policy if exists "claim_document_type_uploaders_delete" on public.claim_document_type_uploaders;
create policy "claim_document_type_uploaders_delete"
  on public.claim_document_type_uploaders for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin')
        and u.is_active = true
    )
  );

grant select, insert, delete on public.claim_document_type_uploaders to authenticated;
grant all on public.claim_document_type_uploaders to service_role;

-- ============================================================
-- 3. TRIGGER: hanya distributor aktif bercakupan Pusat yang boleh ditunjuk
-- ============================================================

create or replace function public.claim_document_type_uploaders_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = new.user_id
      and u.role = 'distributor'
      and u.is_active = true
      and u.distributor_id is not null
      and u.distributor_scope = 'pusat'
  ) then
    raise exception 'Pengunggah khusus harus akun distributor aktif bercakupan Pusat.';
  end if;
  return new;
end
$$;

drop trigger if exists claim_document_type_uploaders_guard on public.claim_document_type_uploaders;
create trigger claim_document_type_uploaders_guard
  before insert on public.claim_document_type_uploaders
  for each row execute function public.claim_document_type_uploaders_guard();

-- 065: Multi-User Distributor — Fase 2 (plans/plan-multi-user-distributor.md)
-- Cakupan Cabang/Pusat per akun distributor dan perusahaan induk distributor.
--
-- 1. distributors.parent_distributor_id (maks. satu tingkat, tanpa siklus,
--    tidak boleh menunjuk diri sendiri) — ditegakkan check + trigger.
-- 2. enum distributor_scope ('cabang' | 'pusat') + users.distributor_scope.
--    Role distributor wajib punya distributor_id + distributor_scope; cabang
--    wajib punya region_id; role lain scope-nya null. Constraint dibuat NOT VALID
--    agar 5 akun distributor lama tanpa perusahaan (dinonaktifkan di Fase 7)
--    tidak menggagalkan migrasi; baris itu tetap bisa dinonaktifkan karena
--    constraint hanya menuntut kelengkapan untuk akun yang aktif.
-- 3. Data: MMS dan BIR berinduk EDM; akun EDM berdepartemen finance/controller
--    → pusat; akun distributor lain yang punya perusahaan → cabang.
--
-- Fase ini BELUM mengubah visibilitas/RLS (menyusul di Fase 3).

-- ============================================================
-- 1. PERUSAHAAN INDUK
-- ============================================================

alter table public.distributors
  add column if not exists parent_distributor_id uuid
  references public.distributors (id) on delete set null;

alter table public.distributors
  drop constraint if exists distributors_parent_not_self;
alter table public.distributors
  add constraint distributors_parent_not_self
  check (parent_distributor_id is null or parent_distributor_id <> id);

create index if not exists idx_distributors_parent
  on public.distributors (parent_distributor_id)
  where parent_distributor_id is not null;

create or replace function public.distributors_guard_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_distributor_id is null then
    return new;
  end if;

  -- Perusahaan yang sudah menjadi induk tidak boleh diberi induk (mencegah siklus).
  if exists (
    select 1 from public.distributors c
    where c.parent_distributor_id = new.id
  ) then
    raise exception 'INDUK_PUNYA_ANAK: perusahaan ini sudah menjadi induk perusahaan lain';
  end if;

  -- Induk yang dipilih tidak boleh punya induk lagi (maksimal satu tingkat).
  if exists (
    select 1 from public.distributors p
    where p.id = new.parent_distributor_id
      and p.parent_distributor_id is not null
  ) then
    raise exception 'INDUK_DUA_TINGKAT: perusahaan induk sudah punya induk';
  end if;

  return new;
end;
$$;

drop trigger if exists distributors_guard_parent on public.distributors;
create trigger distributors_guard_parent
  before insert or update of parent_distributor_id on public.distributors
  for each row execute function public.distributors_guard_parent();

-- ============================================================
-- 2. CAKUPAN AKUN DISTRIBUTOR
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'distributor_scope') then
    create type public.distributor_scope as enum ('cabang', 'pusat');
  end if;
end
$$;

alter table public.users
  add column if not exists distributor_scope public.distributor_scope;

-- ============================================================
-- 3. DATA: induk MMS/BIR → EDM; scope akun yang sudah ada
-- ============================================================

do $$
declare
  v_edm uuid;
begin
  select id into v_edm
  from public.distributors
  where lower(name) = lower('Esham Dima')
  limit 1;

  if v_edm is null then
    raise exception 'Distributor "Esham Dima" tidak ditemukan — periksa nama di master distributor sebelum menjalankan migrasi ini';
  end if;

  update public.distributors
  set parent_distributor_id = v_edm
  where lower(name) in (lower('Mitra Monas Sejahtera'), lower('Bintang Indo Raya'))
    and parent_distributor_id is null;

  -- Akun EDM berdepartemen finance/controller = kantor pusat.
  update public.users u
  set distributor_scope = 'pusat'
  from public.departments d
  where u.department_id = d.id
    and u.role = 'distributor'
    and u.distributor_id = v_edm
    and lower(d.name) in ('finance', 'controller')
    and u.distributor_scope is null;

  -- Akun distributor lain yang sudah punya perusahaan = cabang.
  update public.users
  set distributor_scope = 'cabang'
  where role = 'distributor'
    and distributor_id is not null
    and distributor_scope is null;
end
$$;

-- ============================================================
-- 4. CONSTRAINT KELENGKAPAN AKUN DISTRIBUTOR
-- ============================================================

alter table public.users
  drop constraint if exists users_distributor_fields_check;
alter table public.users
  add constraint users_distributor_fields_check
  check (
    (role <> 'distributor' and distributor_scope is null)
    or (
      role = 'distributor'
      and (
        is_active = false
        or (
          distributor_id is not null
          and distributor_scope is not null
          and (distributor_scope <> 'cabang' or region_id is not null)
        )
      )
    )
  ) not valid;

-- Setelah 5 akun lama dinonaktifkan (Fase 7), jalankan:
--   alter table public.users validate constraint users_distributor_fields_check;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- select name, parent_distributor_id from public.distributors
--   where lower(name) in ('esham dima','mitra monas sejahtera','bintang indo raya');
-- select d.name, u.distributor_scope, count(*) from public.users u
--   join public.distributors d on d.id = u.distributor_id
--   where u.role = 'distributor' group by 1,2 order by 1,2;
-- -- diharapkan: EDM pusat 4, EDM cabang 16, MMS cabang 8, BIR cabang 1 (+ AJS cabang)

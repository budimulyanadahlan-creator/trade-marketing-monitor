-- 027: Master data Distributor
-- Tabel distributors: perusahaan penyalur produk, terpisah dari vendors (vendor jasa marketing).
-- RLS mengikuti pola master data lain: select semua user terautentikasi; tulis hanya admin/superadmin aktif.

-- ============================================================
-- 1. TABLE
-- ============================================================

create table if not exists public.distributors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. RLS
-- ============================================================

alter table public.distributors enable row level security;

drop policy if exists "distributors_select" on public.distributors;
drop policy if exists "distributors_insert_admin" on public.distributors;
drop policy if exists "distributors_update_admin" on public.distributors;
drop policy if exists "distributors_delete_admin" on public.distributors;

create policy "distributors_select" on public.distributors
  for select to authenticated using (true);

create policy "distributors_insert_admin" on public.distributors
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "distributors_update_admin" on public.distributors
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "distributors_delete_admin" on public.distributors
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

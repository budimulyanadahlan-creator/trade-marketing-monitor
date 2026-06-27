-- Phase 3: Approver Settings
-- Tables: approval_levels, approver_assignments

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.approval_levels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sequence   integer not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.approver_assignments (
  id         uuid primary key default gen_random_uuid(),
  level_id   uuid not null references public.approval_levels(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint approver_assignments_level_user_unique unique (level_id, user_id)
);

-- ============================================================
-- 2. ENABLE RLS
-- ============================================================

alter table public.approval_levels enable row level security;
alter table public.approver_assignments enable row level security;

-- ============================================================
-- 3. POLICIES — approval_levels
-- ============================================================

drop policy if exists "approval_levels_select" on public.approval_levels;
drop policy if exists "approval_levels_insert_admin" on public.approval_levels;
drop policy if exists "approval_levels_update_admin" on public.approval_levels;
drop policy if exists "approval_levels_delete_admin" on public.approval_levels;

create policy "approval_levels_select" on public.approval_levels
  for select to authenticated using (true);

create policy "approval_levels_insert_admin" on public.approval_levels
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "approval_levels_update_admin" on public.approval_levels
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "approval_levels_delete_admin" on public.approval_levels
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- ============================================================
-- 4. POLICIES — approver_assignments
-- ============================================================

drop policy if exists "approver_assignments_select" on public.approver_assignments;
drop policy if exists "approver_assignments_insert_admin" on public.approver_assignments;
drop policy if exists "approver_assignments_update_admin" on public.approver_assignments;
drop policy if exists "approver_assignments_delete_admin" on public.approver_assignments;

create policy "approver_assignments_select" on public.approver_assignments
  for select to authenticated using (true);

create policy "approver_assignments_insert_admin" on public.approver_assignments
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "approver_assignments_update_admin" on public.approver_assignments
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "approver_assignments_delete_admin" on public.approver_assignments
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- ============================================================
-- 5. SEED: default approval levels
-- ============================================================

insert into public.approval_levels (name, sequence) values
  ('NSM', 1),
  ('TMM', 2),
  ('BDM', 3),
  ('Finance Manager', 4),
  ('GM', 5)
on conflict (name) do nothing;

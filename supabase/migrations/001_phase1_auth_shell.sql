-- Phase 1: Auth + App Shell
-- Tables: departments, users (extends auth.users)
-- RLS policies for both tables

-- ============================================================
-- 1. TABLES (both first, before any policies)
-- ============================================================
create table if not exists public.departments (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

create type public.user_role as enum ('user', 'manager', 'finance', 'admin', 'superadmin');

create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  department_id uuid references public.departments(id),
  role          public.user_role not null default 'user',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- 2. ENABLE RLS
-- ============================================================
alter table public.departments enable row level security;
alter table public.users enable row level security;

-- ============================================================
-- 3. POLICIES — departments
-- ============================================================
create policy "departments_select_authenticated"
  on public.departments for select
  to authenticated
  using (true);

create policy "departments_insert_admin"
  on public.departments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

create policy "departments_update_admin"
  on public.departments for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

create policy "departments_delete_admin"
  on public.departments for delete
  to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

-- ============================================================
-- 4. POLICIES — users
-- ============================================================
create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);

create policy "users_update_self"
  on public.users for update
  to authenticated
  using (id = auth.uid());

create policy "users_insert_admin"
  on public.users for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

create policy "users_update_admin"
  on public.users for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

-- ============================================================
-- 5. TRIGGER: auto-update updated_at
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_updated_at
  before update on public.users
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 6. SEED: Default departments
-- ============================================================
insert into public.departments (name) values
  ('Trade Marketing'),
  ('Marketing'),
  ('Finance')
on conflict (name) do nothing;

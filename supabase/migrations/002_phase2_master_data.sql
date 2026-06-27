-- Phase 2: Master Data
-- Tables: brands, regions, channels, promotion_categories, vendors, master_budgets, budget_allocations

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.brands (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint brands_code_unique unique(code)
);

create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.channels (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true
);

do $$ begin
  create type public.promotion_type as enum ('TP', 'CP');
exception when duplicate_object then null;
end $$;

create table if not exists public.promotion_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         public.promotion_type not null,
  account_code text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.vendors (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  contact          text,
  service_category text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.master_budgets (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  fiscal_year   integer not null,
  quarter       integer not null check (quarter between 1 and 4),
  total_amount  bigint not null default 0,
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  constraint master_budgets_dept_year_quarter_unique unique(department_id, fiscal_year, quarter)
);

create table if not exists public.budget_allocations (
  id                    uuid primary key default gen_random_uuid(),
  master_budget_id      uuid not null references public.master_budgets(id) on delete cascade,
  brand_id              uuid not null references public.brands(id),
  promotion_category_id uuid not null references public.promotion_categories(id),
  allocated_amount      bigint not null default 0,
  fiscal_year           integer not null,
  created_at            timestamptz not null default now(),
  constraint budget_allocations_unique unique(master_budget_id, brand_id, promotion_category_id)
);

-- ============================================================
-- 2. ENABLE RLS
-- ============================================================

alter table public.brands enable row level security;
alter table public.regions enable row level security;
alter table public.channels enable row level security;
alter table public.promotion_categories enable row level security;
alter table public.vendors enable row level security;
alter table public.master_budgets enable row level security;
alter table public.budget_allocations enable row level security;

-- ============================================================
-- 3. POLICIES
-- ============================================================

-- Brands
drop policy if exists "brands_select" on public.brands;
drop policy if exists "brands_insert_admin" on public.brands;
drop policy if exists "brands_update_admin" on public.brands;
drop policy if exists "brands_delete_admin" on public.brands;

create policy "brands_select" on public.brands
  for select to authenticated using (true);

create policy "brands_insert_admin" on public.brands
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "brands_update_admin" on public.brands
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "brands_delete_admin" on public.brands
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Regions
drop policy if exists "regions_select" on public.regions;
drop policy if exists "regions_insert_admin" on public.regions;
drop policy if exists "regions_update_admin" on public.regions;
drop policy if exists "regions_delete_admin" on public.regions;

create policy "regions_select" on public.regions
  for select to authenticated using (true);

create policy "regions_insert_admin" on public.regions
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "regions_update_admin" on public.regions
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "regions_delete_admin" on public.regions
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Channels
drop policy if exists "channels_select" on public.channels;
drop policy if exists "channels_insert_admin" on public.channels;
drop policy if exists "channels_update_admin" on public.channels;
drop policy if exists "channels_delete_admin" on public.channels;

create policy "channels_select" on public.channels
  for select to authenticated using (true);

create policy "channels_insert_admin" on public.channels
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "channels_update_admin" on public.channels
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "channels_delete_admin" on public.channels
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Promotion Categories
drop policy if exists "promo_categories_select" on public.promotion_categories;
drop policy if exists "promo_categories_insert_admin" on public.promotion_categories;
drop policy if exists "promo_categories_update_admin" on public.promotion_categories;
drop policy if exists "promo_categories_delete_admin" on public.promotion_categories;

create policy "promo_categories_select" on public.promotion_categories
  for select to authenticated using (true);

create policy "promo_categories_insert_admin" on public.promotion_categories
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "promo_categories_update_admin" on public.promotion_categories
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "promo_categories_delete_admin" on public.promotion_categories
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Vendors
drop policy if exists "vendors_select" on public.vendors;
drop policy if exists "vendors_insert_admin" on public.vendors;
drop policy if exists "vendors_update_admin" on public.vendors;
drop policy if exists "vendors_delete_admin" on public.vendors;

create policy "vendors_select" on public.vendors
  for select to authenticated using (true);

create policy "vendors_insert_admin" on public.vendors
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "vendors_update_admin" on public.vendors
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "vendors_delete_admin" on public.vendors
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Master Budgets
drop policy if exists "master_budgets_select" on public.master_budgets;
drop policy if exists "master_budgets_insert_admin" on public.master_budgets;
drop policy if exists "master_budgets_update_admin" on public.master_budgets;
drop policy if exists "master_budgets_delete_admin" on public.master_budgets;

create policy "master_budgets_select" on public.master_budgets
  for select to authenticated using (true);

create policy "master_budgets_insert_admin" on public.master_budgets
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "master_budgets_update_admin" on public.master_budgets
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "master_budgets_delete_admin" on public.master_budgets
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Budget Allocations
drop policy if exists "budget_allocs_select" on public.budget_allocations;
drop policy if exists "budget_allocs_insert_admin" on public.budget_allocations;
drop policy if exists "budget_allocs_update_admin" on public.budget_allocations;
drop policy if exists "budget_allocs_delete_admin" on public.budget_allocations;

create policy "budget_allocs_select" on public.budget_allocations
  for select to authenticated using (true);

create policy "budget_allocs_insert_admin" on public.budget_allocations
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "budget_allocs_update_admin" on public.budget_allocations
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "budget_allocs_delete_admin" on public.budget_allocations
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- ============================================================
-- 4. SEED: channels (fixed reference data)
-- ============================================================

insert into public.channels (name, is_active) values
  ('GT', true),
  ('MT', true)
on conflict (name) do nothing;

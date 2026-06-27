-- Phase 3: Programs + Campaign Submission
-- Tables: programs, campaigns, campaign_files

-- ============================================================
-- 1. ENUMS
-- ============================================================

do $$ begin
  create type public.campaign_status as enum (
    'draft', 'submitted', 'approved_l1', 'approved',
    'rejected', 'ongoing', 'completed', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 2. TABLES
-- ============================================================

create table if not exists public.programs (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  master_budget_id uuid references public.master_budgets(id) on delete set null,
  brand_id         uuid references public.brands(id) on delete set null,
  start_date       date not null,
  end_date         date not null,
  target_budget    bigint not null default 0,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

create table if not exists public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  program_id            uuid references public.programs(id) on delete set null,
  name                  text not null,
  department_id         uuid not null references public.departments(id),
  brand_id              uuid not null references public.brands(id),
  region_id             uuid not null references public.regions(id),
  channel_id            uuid references public.channels(id) on delete set null,
  promotion_category_id uuid references public.promotion_categories(id) on delete set null,
  vendor_id             uuid references public.vendors(id) on delete set null,
  objective             text,
  requested_budget      bigint not null default 0,
  actual_spent          bigint not null default 0,
  status                public.campaign_status not null default 'draft',
  created_by            uuid not null references public.users(id),
  start_date            date,
  end_date              date,
  submitted_at          timestamptz,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

create table if not exists public.campaign_files (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  file_name   text not null,
  file_url    text not null,
  file_type   text not null,
  file_size   bigint not null,
  uploaded_by uuid not null references public.users(id),
  uploaded_at timestamptz not null default now()
);

-- ============================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_campaigns_updated_at on public.campaigns;
create trigger set_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.handle_updated_at();

-- ============================================================
-- 4. ENABLE RLS
-- ============================================================

alter table public.programs enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_files enable row level security;

-- ============================================================
-- 5. POLICIES: programs (read all, write admin only)
-- ============================================================

drop policy if exists "programs_select" on public.programs;
drop policy if exists "programs_insert_admin" on public.programs;
drop policy if exists "programs_update_admin" on public.programs;
drop policy if exists "programs_delete_admin" on public.programs;

create policy "programs_select" on public.programs
  for select to authenticated using (true);

create policy "programs_insert_admin" on public.programs
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "programs_update_admin" on public.programs
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "programs_delete_admin" on public.programs
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- ============================================================
-- 6. POLICIES: campaigns
-- ============================================================

drop policy if exists "campaigns_select" on public.campaigns;
drop policy if exists "campaigns_insert" on public.campaigns;
drop policy if exists "campaigns_update" on public.campaigns;
drop policy if exists "campaigns_delete" on public.campaigns;

-- Owner sees own; manager sees same dept; finance/admin/superadmin see all
create policy "campaigns_select" on public.campaigns
  for select to authenticated
  using (
    created_by = auth.uid()
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('finance', 'admin', 'superadmin')
        and u.is_active = true
    )
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'manager'
        and u.is_active = true
        and u.department_id = campaigns.department_id
    )
  );

create policy "campaigns_insert" on public.campaigns
  for insert to authenticated
  with check (
    created_by = auth.uid()
    AND exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_active = true
    )
  );

-- Owner updates draft/rejected; manager/finance/admin update for workflow
create policy "campaigns_update" on public.campaigns
  for update to authenticated
  using (
    (created_by = auth.uid() and status in ('draft', 'rejected'))
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  );

-- Owner deletes draft; admin deletes anything
create policy "campaigns_delete" on public.campaigns
  for delete to authenticated
  using (
    (created_by = auth.uid() and status = 'draft')
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'superadmin')
        and u.is_active = true
    )
  );

-- ============================================================
-- 7. POLICIES: campaign_files
-- ============================================================

drop policy if exists "campaign_files_select" on public.campaign_files;
drop policy if exists "campaign_files_insert" on public.campaign_files;
drop policy if exists "campaign_files_delete" on public.campaign_files;

create policy "campaign_files_select" on public.campaign_files
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = campaign_files.campaign_id
        and (
          c.created_by = auth.uid()
          OR exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role in ('finance', 'admin', 'superadmin')
              and u.is_active = true
          )
          OR exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = 'manager'
              and u.is_active = true
              and u.department_id = c.department_id
          )
        )
    )
  );

create policy "campaign_files_insert" on public.campaign_files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    AND exists (
      select 1 from public.campaigns c
      where c.id = campaign_files.campaign_id
        and c.created_by = auth.uid()
    )
  );

create policy "campaign_files_delete" on public.campaign_files
  for delete to authenticated
  using (
    uploaded_by = auth.uid()
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'superadmin')
        and u.is_active = true
    )
  );

-- ============================================================
-- 8. STORAGE: campaign-documents bucket
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-documents',
  'campaign-documents',
  false,
  5242880,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists "campaign_docs_insert" on storage.objects;
drop policy if exists "campaign_docs_select" on storage.objects;
drop policy if exists "campaign_docs_delete" on storage.objects;

create policy "campaign_docs_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'campaign-documents'
    AND exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_active = true
    )
  );

create policy "campaign_docs_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'campaign-documents'
    AND exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_active = true
    )
  );

create policy "campaign_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'campaign-documents'
    AND exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_active = true
    )
  );

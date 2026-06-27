-- Phase 7: Distributor receipts table
-- Stores acknowledgement records when a Distributor marks an approved SKP as received.
-- Distributor can only checklist SKPs from their own region; one receipt per SKP per distributor.

-- 1. Create table
create table if not exists public.distributor_receipts (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  received_by  uuid not null references public.users(id) on delete cascade,
  received_at  timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now(),
  -- Prevent the same distributor from receipting the same SKP twice
  unique (campaign_id, received_by)
);

-- 2. RLS
alter table public.distributor_receipts enable row level security;

-- Distributor: insert + select own receipts (only for SKPs in their region)
create policy "distributor_receipts_insert_own" on public.distributor_receipts
  for insert to authenticated
  with check (
    received_by = auth.uid()
    and exists (
      select 1 from public.users u
      join public.campaigns c on c.id = campaign_id
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
        and c.region_id = u.region_id
        and c.status = 'approved'
    )
  );

create policy "distributor_receipts_select_own" on public.distributor_receipts
  for select to authenticated
  using (
    received_by = auth.uid()
    and exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'distributor'
        and is_active = true
    )
  );

-- Admin / superadmin / finance: read all receipts (for detail SKP view)
create policy "distributor_receipts_select_staff" on public.distributor_receipts
  for select to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin', 'finance', 'manager')
        and is_active = true
    )
  );

-- Admin / superadmin: full management (delete if needed)
create policy "distributor_receipts_all_admin" on public.distributor_receipts
  for all to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin')
        and is_active = true
    )
  );

-- 3. Realtime (so Distributor list page updates when another tab receipts)
alter publication supabase_realtime add table public.distributor_receipts;

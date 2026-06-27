-- Phase 5: Realizations table for invoice-based spend tracking (PRD v2)
-- Replaces direct actual_spent updates with a dedicated realizations table.
-- actual_spent on campaigns is now auto-computed via trigger from sum of realizations.

-- 1. Add missing campaign_status enum values
alter type public.campaign_status add value if not exists 'claim_submitted';
alter type public.campaign_status add value if not exists 'paid';

-- 2. Realizations table
create table if not exists public.realizations (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  invoice_number   text not null,
  amount           bigint not null check (amount > 0),
  realization_date date not null,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- 3. RLS
alter table public.realizations enable row level security;

-- Admin/superadmin: full CRUD
create policy "realizations_all_admin" on public.realizations
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

-- Finance / manager: read-only
create policy "realizations_select_finance_manager" on public.realizations
  for select to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('finance', 'manager')
        and is_active = true
    )
  );

-- Campaign owners: view their own campaign's realizations
create policy "realizations_select_owner" on public.realizations
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns
      where id = realizations.campaign_id
        and created_by = auth.uid()
    )
  );

-- 4. Trigger: keep campaigns.actual_spent in sync with sum(realizations.amount)
create or replace function public.sync_campaign_actual_spent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
begin
  v_campaign_id := coalesce(NEW.campaign_id, OLD.campaign_id);

  update public.campaigns
  set actual_spent = (
    select coalesce(sum(amount), 0)
    from public.realizations
    where campaign_id = v_campaign_id
  )
  where id = v_campaign_id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists sync_actual_spent_on_realization on public.realizations;
create trigger sync_actual_spent_on_realization
  after insert or update or delete on public.realizations
  for each row execute function public.sync_campaign_actual_spent();

-- 5. Realtime
alter publication supabase_realtime add table public.realizations;

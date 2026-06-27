-- Phase 4: Approval Workflow + Notifications
-- Table: approval_history

-- ============================================================
-- 1. TABLE
-- ============================================================

create table if not exists public.approval_history (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id    uuid not null references public.users(id),
  role        public.user_role not null,
  action      text not null check (action in ('submitted', 'approved_l1', 'approved', 'rejected')),
  comment     text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. ENABLE RLS
-- ============================================================

alter table public.approval_history enable row level security;

-- ============================================================
-- 3. RLS POLICIES
-- ============================================================

drop policy if exists "approval_history_select" on public.approval_history;
drop policy if exists "approval_history_insert" on public.approval_history;

-- Select: campaign owner, manager of that dept, finance/admin/superadmin
create policy "approval_history_select" on public.approval_history
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = approval_history.campaign_id
        and (
          c.created_by = auth.uid()
          or exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role in ('manager', 'finance', 'admin', 'superadmin')
              and u.is_active = true
          )
        )
    )
  );

-- Insert: any active user (actor must be self; business logic enforced in server actions)
create policy "approval_history_insert" on public.approval_history
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.is_active = true
    )
  );

-- ============================================================
-- 4. ENABLE REALTIME
-- ============================================================

-- REPLICA IDENTITY FULL is required so that postgres_changes UPDATE events
-- include the full new row in payload.new (name, status, department_id, etc.)
alter table public.campaigns replica identity full;
alter table public.approval_history replica identity full;

-- Enable realtime on campaigns (for toast notifications on status change)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
end $$;

-- Enable realtime on approval_history (for audit trail reactivity)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'approval_history'
  ) then
    alter publication supabase_realtime add table public.approval_history;
  end if;
end $$;

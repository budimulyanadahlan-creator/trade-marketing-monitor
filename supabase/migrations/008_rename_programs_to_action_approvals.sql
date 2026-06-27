-- PRD v2: Rename programs → action_approvals
-- "Action Approval (AA)" replaces "Program" per updated terminology.

-- ============================================================
-- 1. RENAME TABLE
-- ============================================================

alter table public.programs rename to action_approvals;

-- ============================================================
-- 2. RENAME FK COLUMN IN campaigns
-- ============================================================

alter table public.campaigns rename column program_id to action_approval_id;

-- ============================================================
-- 3. UPDATE RLS POLICIES ON action_approvals
-- (old policies were attached to 'programs' by name; after rename
--  the table keeps them but we drop & recreate under new names)
-- ============================================================

drop policy if exists "programs_select"      on public.action_approvals;
drop policy if exists "programs_insert_admin" on public.action_approvals;
drop policy if exists "programs_update_admin" on public.action_approvals;
drop policy if exists "programs_delete_admin" on public.action_approvals;

create policy "action_approvals_select" on public.action_approvals
  for select to authenticated using (true);

create policy "action_approvals_insert_admin" on public.action_approvals
  for insert to authenticated
  with check (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "action_approvals_update_admin" on public.action_approvals
  for update to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

create policy "action_approvals_delete_admin" on public.action_approvals
  for delete to authenticated
  using (exists (
    select 1 from public.users
    where id = auth.uid() and role in ('admin','superadmin') and is_active = true
  ));

-- Fix: campaigns UPDATE policy missing explicit WITH CHECK.
-- Without WITH CHECK, PostgreSQL applies USING as WITH CHECK too.
-- This blocked owners from changing status to 'submitted' because
-- the new row no longer satisfies status IN ('draft','rejected').

drop policy if exists "campaigns_update" on public.campaigns;

create policy "campaigns_update" on public.campaigns
  for update to authenticated
  -- USING: which existing rows can be targeted
  using (
    (created_by = auth.uid() and status in ('draft', 'rejected'))
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  )
  -- WITH CHECK: what the row is allowed to look like after the update
  with check (
    created_by = auth.uid()
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('manager', 'finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  );

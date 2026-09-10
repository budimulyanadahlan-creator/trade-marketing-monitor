-- Allow Finance to record realizations (add/delete), same as Admin/Superadmin.
-- Finance previously had read-only access; app/actions/realizations.ts now
-- also allows the "finance" role through addRealizationAction and
-- deleteRealizationAction, so RLS must be widened to match or those
-- inserts/deletes would still be rejected by Postgres.

drop policy if exists "realizations_all_admin" on public.realizations;

create policy "realizations_all_admin_finance" on public.realizations
  for all to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin', 'finance')
        and is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'superadmin', 'finance')
        and is_active = true
    )
  );

-- Finance is now covered by the "for all" policy above; narrow the old
-- read-only policy to manager only so it isn't a duplicate/confusing grant.
drop policy if exists "realizations_select_finance_manager" on public.realizations;

create policy "realizations_select_manager" on public.realizations
  for select to authenticated
  using (
    exists (
      select 1 from public.users
      where id = auth.uid()
        and role = 'manager'
        and is_active = true
    )
  );

-- Distributors should see all approved campaigns from Sales/Trade Marketing
-- departments regardless of region (confirmed requirement: distributors are
-- not region-locked for viewing). Drop the region_id match entirely — the
-- app layer (campaigns/page.tsx, rekap/page.tsx) still restricts by
-- department, but region is no longer a visibility gate at any layer.

drop policy if exists "campaigns_select_distributor" on public.campaigns;

create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    campaigns.status = 'approved'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

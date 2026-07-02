-- Fix: Distributor RLS policy never accounted for Finance/Controller-dept
-- distributors being region-exempt (able to see all regions), even though
-- the app layer (campaigns/page.tsx, rekap/page.tsx) already implements this
-- exemption. Without it, RLS silently blocks every campaign for any
-- Finance/Controller distributor whose region_id doesn't exactly match.

drop policy if exists "campaigns_select_distributor" on public.campaigns;

create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    campaigns.status = 'approved'
    and exists (
      select 1 from public.users u
      left join public.departments d on d.id = u.department_id
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
        and (
          lower(d.name) in ('finance', 'controller')
          or u.region_id = campaigns.region_id
        )
    )
  );

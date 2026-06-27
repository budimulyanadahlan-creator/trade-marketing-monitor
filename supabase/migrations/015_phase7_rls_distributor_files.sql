-- Phase 7: Allow Distributor to view campaign files for approved campaigns in their region
-- Without this, campaign_files RLS blocks distributors and the Dokumen section stays empty.

create policy "campaign_files_select_distributor" on public.campaign_files
  for select to authenticated
  using (
    exists (
      select 1
      from public.campaigns c
      join public.users u on u.id = auth.uid()
      where c.id = campaign_files.campaign_id
        and c.status = 'approved'
        and c.region_id = u.region_id
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

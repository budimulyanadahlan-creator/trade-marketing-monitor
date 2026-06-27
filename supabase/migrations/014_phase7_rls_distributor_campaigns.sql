-- Phase 7: RLS policy for Distributor role on campaigns
-- Distributors can only SELECT campaigns where:
--   1. status = 'approved' (fully approved, not ongoing/claim_submitted/etc.)
--   2. region_id matches the distributor's own region_id
-- This is a separate permissive policy; Supabase ORs it with existing campaigns_select.

create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    campaigns.status = 'approved'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
        and u.region_id = campaigns.region_id
    )
  );

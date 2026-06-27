-- Phase 3 (PRD v2): Region Lock RLS for Sales Department users
-- Sales Dept users (role='user', dept name='sales', has region_id) should only
-- be able to SELECT campaigns that belong to their own region.
--
-- Strategy: drop & recreate campaigns_select to add a new OR branch.
-- Existing branches (owner, finance/admin/superadmin, manager) are preserved.

drop policy if exists "campaigns_select" on public.campaigns;

create policy "campaigns_select" on public.campaigns
  for select to authenticated
  using (
    -- Owner always sees their own campaigns
    created_by = auth.uid()
    -- Finance / Admin / Superadmin see all campaigns
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('finance', 'admin', 'superadmin')
        and u.is_active = true
    )
    -- Manager sees campaigns from the same department
    OR exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'manager'
        and u.is_active = true
        and u.department_id = campaigns.department_id
    )
    -- Sales Dept users see all campaigns within their assigned region
    OR exists (
      select 1 from public.users u
      join public.departments d on d.id = u.department_id
      where u.id = auth.uid()
        and u.role = 'user'
        and u.is_active = true
        and u.region_id is not null
        and lower(d.name) = 'sales'
        and u.region_id = campaigns.region_id
    )
  );

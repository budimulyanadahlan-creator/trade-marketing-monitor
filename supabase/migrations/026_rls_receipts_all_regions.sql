-- Migration 025 removed the region gate for distributor campaign visibility,
-- but distributor_receipts_insert_own (013) still requires
-- c.region_id = u.region_id. A distributor viewing an approved campaign from
-- another region (or with a NULL region_id) hits an RLS violation when
-- confirming receipt. Align the insert policy with 025: any active
-- distributor may receipt any approved campaign.

drop policy if exists "distributor_receipts_insert_own" on public.distributor_receipts;

create policy "distributor_receipts_insert_own" on public.distributor_receipts
  for insert to authenticated
  with check (
    received_by = auth.uid()
    and exists (
      select 1 from public.users u
      join public.campaigns c on c.id = campaign_id
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
        and c.status = 'approved'
    )
  );

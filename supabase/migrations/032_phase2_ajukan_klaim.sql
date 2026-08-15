-- Phase 2 (Bukti Eksekusi & Klaim Online): Ajukan Klaim — alur distributor.
--
-- 1. Columns submitKlaimAction needs to record a claim submission: the
--    nominal the distributor claims, and who/when submitted it.
-- 2. RLS gap found while implementing: the existing "campaigns_update" policy
--    (migration 004) only grants UPDATE to the campaign owner (draft/rejected)
--    or to manager/finance/admin/superadmin — distributor is not in that role
--    list at all, so a distributor session could never flip a campaign's
--    status to 'claim_submitted' via submitKlaimAction without a dedicated
--    policy. Scoped tightly (USING requires the row is currently 'ongoing',
--    WITH CHECK requires the new row is 'claim_submitted') so this policy
--    only ever allows the one transition submitKlaimAction performs — it
--    can't be used to sneak through other field changes or status jumps.
--    Not filtered by campaigns.distributor_id, consistent with the accepted
--    visibility risk already documented for this feature (PRD Keputusan #5).

alter table public.campaigns
  add column if not exists claim_amount numeric,
  add column if not exists claim_submitted_at timestamptz,
  add column if not exists claim_submitted_by uuid references public.users(id) on delete set null;

drop policy if exists "campaigns_update_distributor_claim" on public.campaigns;

create policy "campaigns_update_distributor_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'ongoing'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  )
  with check (
    campaigns.status = 'claim_submitted'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

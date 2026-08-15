-- Phase 3 (Bukti Eksekusi & Klaim Online): Batalkan Pengajuan Klaim.
--
-- 1. claim_events: riwayat submit/cancel per SKP. claim_amount disimpan per
--    baris (bukan hanya dibaca dari campaigns.claim_amount) karena kolom itu
--    dikosongkan saat dibatalkan — tanpa ini riwayat kehilangan nominal
--    pengajuan yang sudah dibatalkan.
-- 2. campaigns_update_distributor_cancel_claim: RLS gap sejenis migration
--    032 — policy update distributor yang ada di 032 hanya mengizinkan
--    transisi ongoing → claim_submitted (submit), bukan sebaliknya. Tanpa
--    policy baru ini distributor tidak bisa membatalkan pengajuannya
--    sendiri (admin/superadmin sudah tercakup oleh "campaigns_update" yang
--    lebih permisif di migration 004).

create table if not exists public.claim_events (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  action      text not null check (action in ('submitted', 'cancelled')),
  claim_amount numeric,
  created_at  timestamptz not null default now()
);

alter table public.claim_events enable row level security;

drop policy if exists "claim_events_select" on public.claim_events;

create policy "claim_events_select" on public.claim_events
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'superadmin', 'finance', 'manager')
        and u.is_active = true
    )
    or exists (
      select 1
      from public.campaigns c
      join public.users u on u.id = auth.uid()
      where c.id = claim_events.campaign_id
        and c.status in ('approved', 'ongoing', 'claim_submitted', 'paid', 'completed')
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

drop policy if exists "claim_events_insert" on public.claim_events;

create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('distributor', 'admin', 'superadmin')
        and u.is_active = true
    )
  );

drop policy if exists "campaigns_update_distributor_cancel_claim" on public.campaigns;

create policy "campaigns_update_distributor_cancel_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  )
  with check (
    campaigns.status = 'ongoing'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

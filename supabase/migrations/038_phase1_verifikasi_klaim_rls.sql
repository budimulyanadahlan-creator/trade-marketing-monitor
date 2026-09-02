-- Phase 1 (Verifikasi Klaim oleh Finance): sapuan RLS & audit untuk dua
-- status baru (claim_verified, ready_to_pay). Jalankan SETELAH migration 037
-- selesai (eksekusi terpisah — nilai enum baru tidak boleh dipakai dalam
-- transaksi yang sama dengan ADD VALUE).
--
-- 1. campaigns_select_distributor (031): tambah claim_verified/ready_to_pay
--    agar distributor tetap bisa melihat SKP-nya selama verifikasi berjalan.
-- 2. campaign_files_select_distributor (031): jendela status yang sama untuk
--    melihat/mengunduh dokumen. Jendela INSERT file distributor (031) SENGAJA
--    tidak diubah — upload tetap berhenti di claim_submitted.
-- 3. claim_events.action check constraint (033): dua aksi audit baru,
--    'claim_verified' dan 'ready_to_pay'.
-- 4. claim_events_insert (033): finance kini ikut mencatat event (approve
--    klaim & akan segera dibayar) — sebelumnya hanya distributor/admin/
--    superadmin (submit & cancel).
-- 5. claim_events_select (033): daftar status distributor diperluas dengan
--    dua status baru agar riwayat klaim tetap terlihat.
--
-- Tidak perlu policy UPDATE campaigns baru: "campaigns_update" (004) sudah
-- mengizinkan finance/admin/superadmin meng-update tanpa syarat status, dan
-- kedua transisi baru hanya dilakukan role tersebut.

drop policy if exists "campaigns_select_distributor" on public.campaigns;

create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    campaigns.status in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed')
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

drop policy if exists "campaign_files_select_distributor" on public.campaign_files;

create policy "campaign_files_select_distributor" on public.campaign_files
  for select to authenticated
  using (
    exists (
      select 1
      from public.campaigns c
      join public.users u on u.id = auth.uid()
      where c.id = campaign_files.campaign_id
        and c.status in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed')
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

alter table public.claim_events
  drop constraint if exists claim_events_action_check;

alter table public.claim_events
  add constraint claim_events_action_check
  check (action in ('submitted', 'cancelled', 'claim_verified', 'ready_to_pay'));

drop policy if exists "claim_events_insert" on public.claim_events;

create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('distributor', 'finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  );

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
        and c.status in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed')
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

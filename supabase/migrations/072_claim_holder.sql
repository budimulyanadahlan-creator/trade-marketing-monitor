-- 072: Multi-User Distributor — Fase 9 (plans/plan-multi-user-distributor.md)
-- Pemegang klaim.
--
-- Akun yang menekan Submit Klaim (campaigns.claim_submitted_by) menjadi
-- pemegang klaim. Selama SKP berstatus claim_submitted, hanya pemegang klaim
-- (dan admin/superadmin lewat policy admin yang sudah ada) yang boleh:
--   - membatalkan klaim            (campaigns_update_distributor_cancel_claim)
--   - mengubah nominal klaim       (campaigns_update_distributor_edit_claim_amount)
--   - mengupload dokumen revisi    (campaign_files_insert_distributor)
-- Submit klaim wajib mencatat diri sendiri sebagai pemegang
-- (campaigns_update_distributor_claim).
--
-- Aplikasi sudah menegakkan aturan yang sama (lib/distributor-campaign-guard.ts
-- → claimHolderActionError); migrasi ini lapis kedua untuk permintaan langsung
-- ke PostgREST. Hapus file sudah dibatasi pengunggah (campaign_files_delete,
-- 003) dan dokumen klaim terkunci setelah submit di route DELETE /api/upload.
--
-- Aman dijalankan sebelum atau sesudah deploy aplikasi Fase 9: aplikasi lama
-- pun selalu mengisi claim_submitted_by = akun pengaju.

-- ============================================================
-- 1. campaigns — submit: pengaju = pemegang
-- ============================================================

drop policy if exists "campaigns_update_distributor_claim" on public.campaigns;
create policy "campaigns_update_distributor_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'ongoing'
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  )
  with check (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- ============================================================
-- 2. campaigns — batal klaim: hanya pemegang
-- ============================================================

drop policy if exists "campaigns_update_distributor_cancel_claim" on public.campaigns;
create policy "campaigns_update_distributor_cancel_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  )
  with check (
    campaigns.status = 'ongoing'
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- ============================================================
-- 3. campaigns — ubah nominal: hanya pemegang, pemegang tidak berubah
-- ============================================================

drop policy if exists "campaigns_update_distributor_edit_claim_amount" on public.campaigns;
create policy "campaigns_update_distributor_edit_claim_amount" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  )
  with check (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- ============================================================
-- 4. campaign_files — upload revisi: hanya pemegang
-- ============================================================

drop policy if exists "campaign_files_insert_distributor" on public.campaign_files;
create policy "campaign_files_insert_distributor" on public.campaign_files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and document_type_id is not null
    and public.distributor_campaign_access_by_id(
      campaign_files.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_files.campaign_id
        and (
          c.status in ('approved', 'ongoing')
          or (
            c.status = 'claim_submitted'
            and c.claim_submitted_by = (select auth.uid())
            and exists (
              select 1 from public.claim_item_verifications civ
              where civ.campaign_id = c.id
                and civ.document_type_id = campaign_files.document_type_id
                and civ.status = 'revision_requested'
            )
          )
        )
    )
  );

-- Verifikasi:
-- select policyname, cmd from pg_policies
--  where schemaname = 'public'
--    and policyname in (
--      'campaigns_update_distributor_claim',
--      'campaigns_update_distributor_cancel_claim',
--      'campaigns_update_distributor_edit_claim_amount',
--      'campaign_files_insert_distributor'
--    );

-- 067: Multi-User Distributor — Fase 3 (plans/plan-multi-user-distributor.md)
-- Visibilitas SKP per perusahaan distributor.
--
-- Satu sumber kebenaran di database untuk dua pertanyaan — "boleh lihat?" dan
-- "boleh bertindak?" — yang dipakai semua policy RLS distributor pada
-- campaigns, campaign_files, distributor_claim_checklists,
-- distributor_receipts, claim_events, dan claim_item_verifications.
-- Padanan sisi aplikasi: lib/distributor-campaign-guard.ts (modul murni).
--
-- Aturan (keputusan PRD prd-multi-user-distributor.md):
--   SKP terlihat oleh distributor jika akun aktif, SKP berstatus Disetujui s.d.
--   Selesai, departemen Sales/Trade Marketing, dan salah satu:
--     (a) perusahaan sama + scope pusat                 → 'act'  (semua region)
--     (b) perusahaan sama + scope cabang + region sama  → 'act'
--     (c) scope pusat + perusahaan akun = INDUK SKP     → 'view' (hanya lihat)
--   Scope null (akun lama) diperlakukan sebagai cabang. Akun tanpa perusahaan
--   tidak melihat apa pun.
--   SEMENTARA (sampai Fase 6): SKP tanpa perusahaan diperlakukan seperti SKP
--   perusahaan akun sendiri — cabang di region sama / pusat semua region → 'act'.
--   Pengecualian region lama berbasis departemen finance/controller (024)
--   dihapus, digantikan scope.
--
-- Pola performa (042): konteks akun diambil sekali per query lewat
-- (select public.distributor_viewer_ctx()); fungsi akses per baris hanya
-- membandingkan kolom + satu lookup kecil (departments / distributors).

-- ============================================================
-- 1. KONTEKS AKUN DISTRIBUTOR YANG LOGIN
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'distributor_viewer') then
    create type public.distributor_viewer as (
      user_id         uuid,
      distributor_id  uuid,
      scope           public.distributor_scope,
      region_id       uuid
    );
  end if;
end
$$;

-- NULL (composite kosong) untuk user non-distributor / nonaktif / belum login.
create or replace function public.distributor_viewer_ctx()
returns public.distributor_viewer
language sql
stable
security definer
set search_path = public
as $$
  select row(u.id, u.distributor_id, u.distributor_scope, u.region_id)::public.distributor_viewer
    from public.users u
   where u.id = auth.uid()
     and u.is_active = true
     and u.role = 'distributor';
$$;

revoke all on function public.distributor_viewer_ctx() from public;
grant execute on function public.distributor_viewer_ctx() to authenticated;

-- ============================================================
-- 2. FUNGSI AKSES: 'act' | 'view' | NULL
-- ============================================================

create or replace function public.distributor_campaign_access(
  p_distributor_id uuid,
  p_region_id      uuid,
  p_department_id  uuid,
  p_status         public.campaign_status,
  v                public.distributor_viewer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- bukan distributor aktif / akun tanpa perusahaan
    when v.user_id is null or v.distributor_id is null then null
    -- jendela status yang terlihat distributor
    when p_status not in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed') then null
    -- hanya SKP Sales / Trade Marketing
    when not exists (
      select 1 from public.departments d
       where d.id = p_department_id
         and lower(trim(d.name)) in ('sales', 'trade marketing')
    ) then null
    -- perusahaan sama, atau SKP belum punya perusahaan (sementara, sampai Fase 6)
    when p_distributor_id is null or p_distributor_id = v.distributor_id then
      case
        when v.scope = 'pusat' then 'act'
        when p_region_id is not null and p_region_id = v.region_id then 'act'
        else null
      end
    -- pusat perusahaan induk: hanya lihat
    when v.scope = 'pusat' and exists (
      select 1 from public.distributors c
       where c.id = p_distributor_id
         and c.parent_distributor_id = v.distributor_id
    ) then 'view'
    else null
  end;
$$;

-- Versi per ID SKP untuk tabel anak. SECURITY DEFINER agar lookup campaigns
-- tidak tunduk RLS campaigns (menghindari evaluasi policy berlapis).
create or replace function public.distributor_campaign_access_by_id(
  p_campaign_id uuid,
  v             public.distributor_viewer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status, v)
    from public.campaigns c
   where c.id = p_campaign_id;
$$;

revoke all on function public.distributor_campaign_access(uuid, uuid, uuid, public.campaign_status, public.distributor_viewer) from public;
revoke all on function public.distributor_campaign_access_by_id(uuid, public.distributor_viewer) from public;
grant execute on function public.distributor_campaign_access(uuid, uuid, uuid, public.campaign_status, public.distributor_viewer) to authenticated;
grant execute on function public.distributor_campaign_access_by_id(uuid, public.distributor_viewer) to authenticated;

-- ============================================================
-- 3. campaigns
-- ============================================================

drop policy if exists "campaigns_select_distributor" on public.campaigns;
create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) is not null
  );

-- Submit klaim: ongoing → claim_submitted (032)
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
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- Batal klaim: claim_submitted → ongoing (033)
drop policy if exists "campaigns_update_distributor_cancel_claim" on public.campaigns;
create policy "campaigns_update_distributor_cancel_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
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

-- Ubah nominal klaim sambil tetap claim_submitted (040)
drop policy if exists "campaigns_update_distributor_edit_claim_amount" on public.campaigns;
create policy "campaigns_update_distributor_edit_claim_amount" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  )
  with check (
    campaigns.status = 'claim_submitted'
    and public.distributor_campaign_access(
      campaigns.distributor_id, campaigns.region_id, campaigns.department_id, campaigns.status,
      (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- ============================================================
-- 4. campaign_files
-- ============================================================

drop policy if exists "campaign_files_select_distributor" on public.campaign_files;
create policy "campaign_files_select_distributor" on public.campaign_files
  for select to authenticated
  using (
    public.distributor_campaign_access_by_id(
      campaign_files.campaign_id, (select public.distributor_viewer_ctx())
    ) is not null
  );

-- Upload dokumen klaim (031/040): hanya yang boleh bertindak; jendela status
-- dan syarat revisi tetap seperti 040.
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

-- ============================================================
-- 5. distributor_claim_checklists (023)
-- Masih per akun sampai Fase 8; di sini hanya ditambah gerbang SKP terlihat /
-- boleh bertindak.
-- ============================================================

drop policy if exists "distributor_claim_checklists_select_distributor" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_select_distributor" on public.distributor_claim_checklists
  for select to authenticated
  using (
    (
      distributor_id = (select auth.uid())
      and public.distributor_campaign_access_by_id(
        distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
      ) is not null
    )
    or exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin', 'finance', 'manager')
        and u.is_active = true
    )
  );

drop policy if exists "distributor_claim_checklists_insert" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_insert" on public.distributor_claim_checklists
  for insert to authenticated
  with check (
    distributor_id = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
  );

drop policy if exists "distributor_claim_checklists_update" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_update" on public.distributor_claim_checklists
  for update to authenticated
  using (
    distributor_id = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
  );

-- ============================================================
-- 6. distributor_receipts (013/026)
-- ============================================================

drop policy if exists "distributor_receipts_insert_own" on public.distributor_receipts;
create policy "distributor_receipts_insert_own" on public.distributor_receipts
  for insert to authenticated
  with check (
    received_by = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_receipts.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
    and exists (
      select 1 from public.campaigns c
      where c.id = distributor_receipts.campaign_id
        and c.status = 'approved'
    )
  );

drop policy if exists "distributor_receipts_select_own" on public.distributor_receipts;
create policy "distributor_receipts_select_own" on public.distributor_receipts
  for select to authenticated
  using (
    received_by = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_receipts.campaign_id, (select public.distributor_viewer_ctx())
    ) is not null
  );

-- ============================================================
-- 7. claim_events (033/038)
-- ============================================================

drop policy if exists "claim_events_select" on public.claim_events;
create policy "claim_events_select" on public.claim_events
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin', 'finance', 'manager')
        and u.is_active = true
    )
    or public.distributor_campaign_access_by_id(
      claim_events.campaign_id, (select public.distributor_viewer_ctx())
    ) is not null
  );

drop policy if exists "claim_events_insert" on public.claim_events;
create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role in ('finance', 'admin', 'superadmin')
          and u.is_active = true
      )
      or public.distributor_campaign_access_by_id(
        claim_events.campaign_id, (select public.distributor_viewer_ctx())
      ) = 'act'
    )
  );

-- ============================================================
-- 8. claim_item_verifications (039)
-- ============================================================

drop policy if exists "claim_item_verifications_select" on public.claim_item_verifications;
create policy "claim_item_verifications_select" on public.claim_item_verifications
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = claim_item_verifications.campaign_id
        and (
          c.created_by = (select auth.uid())
          or exists (
            select 1 from public.users u
            where u.id = (select auth.uid())
              and u.role in ('finance', 'admin', 'superadmin')
              and u.is_active = true
          )
          or exists (
            select 1 from public.users u
            where u.id = (select auth.uid())
              and u.role = 'manager'
              and u.is_active = true
              and u.department_id = c.department_id
          )
          or (
            c.status in ('claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed')
            and public.distributor_campaign_access(
              c.distributor_id, c.region_id, c.department_id, c.status,
              (select public.distributor_viewer_ctx())
            ) is not null
          )
        )
    )
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi; lihat juga
-- supabase/tests/067_distributor_campaign_access.sql untuk tes aturan)
-- ============================================================
-- select policyname, cmd from pg_policies
--  where tablename in ('campaigns','campaign_files','distributor_claim_checklists',
--                      'distributor_receipts','claim_events','claim_item_verifications')
--    and (qual ilike '%distributor_campaign_access%' or with_check ilike '%distributor_campaign_access%')
--  order by tablename, policyname;
-- -- diharapkan 13 baris.

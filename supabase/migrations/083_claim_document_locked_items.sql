-- 083: Pengunggah Khusus Dokumen Klaim — Fase 2
-- (plans/plan-pengunggah-khusus-dokumen-klaim.md)
-- Item terkunci di SKP perusahaan sendiri (sebelum klaim diajukan).
--
-- Lapis kedua (RLS) untuk aturan yang ditegakkan aplikasi di
-- lib/claim-document-uploaders.ts:
--
--   Pengunggah khusus EFEKTIF untuk (SKP, jenis dokumen) = akun yang ditunjuk
--   (claim_document_type_uploaders, 082), berperan distributor, AKTIF, dan
--   perusahaannya = perusahaan SKP atau perusahaan INDUK dari perusahaan SKP.
--   Daftar efektif tidak kosong → item TERKUNCI.
--
-- Isi:
--   1. Fungsi claim_document_special_uploader_ids(SKP, jenis dokumen),
--      claim_document_is_locked(SKP, jenis dokumen),
--      is_claim_document_special_uploader(SKP, jenis dokumen, akun), dan
--      claim_document_has_file(SKP, jenis dokumen).
--   2. campaign_files_insert_distributor: untuk item terkunci, hanya
--      pengunggah khusus efektif. Syarat lain (akses 'act', jendela status,
--      pemegang klaim saat revisi) TIDAK berubah di fase ini — jangkauan
--      lintas perusahaan menyusul di Fase 3, jendela sesudah submit di Fase 4.
--   3. distributor_claim_checklists insert/update: untuk item terkunci,
--      is_fulfilled harus sama dengan "ada file jenis itu di SKP". Centang
--      manual tanpa file (atau melepas centang saat file masih ada) ditolak
--      untuk semua akun distributor, termasuk pengunggah khusus; perubahan
--      otomatis sesudah upload / hapus file tetap lolos.
--
-- Admin/superadmin: tidak ada policy baru. Aplikasi menulis file dan
-- checklist item terkunci atas nama admin lewat klien sistem (service role)
-- setelah lolos pengaman aplikasi; hapus file sudah diizinkan policy
-- campaign_files_delete (003).
--
-- Selama belum ada penunjukan (atau semua yang ditunjuk nonaktif), tidak ada
-- item yang terkunci dan semua policy berperilaku persis seperti 071/072.
--
-- Aman dijalankan sebelum maupun sesudah push aplikasi Fase 2.
-- Prasyarat: migrasi 071, 072, 077, 082 sudah dijalankan.

-- ============================================================
-- 1. FUNGSI
-- ============================================================

create or replace function public.claim_document_special_uploader_ids(
  p_campaign_id      uuid,
  p_document_type_id uuid
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
    from public.campaigns c
    join public.claim_document_type_uploaders a
      on a.document_type_id = p_document_type_id
    join public.users u
      on u.id = a.user_id
    left join public.distributors d
      on d.id = c.distributor_id
   where c.id = p_campaign_id
     and c.distributor_id is not null
     and u.role = 'distributor'
     and u.is_active = true
     and u.distributor_id is not null
     and (
       u.distributor_id = c.distributor_id
       or u.distributor_id = d.parent_distributor_id
     );
$$;

comment on function public.claim_document_special_uploader_ids(uuid, uuid) is
  'ID akun pengunggah khusus EFEKTIF sebuah jenis dokumen klaim pada sebuah SKP: ditunjuk, distributor aktif, perusahaan = perusahaan SKP atau induknya. Padanan effectiveSpecialUploaderIds di lib/claim-document-uploaders.ts. (083)';

create or replace function public.claim_document_is_locked(
  p_campaign_id      uuid,
  p_document_type_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.claim_document_special_uploader_ids(p_campaign_id, p_document_type_id)
  );
$$;

comment on function public.claim_document_is_locked(uuid, uuid) is
  'true bila jenis dokumen klaim ini punya pengunggah khusus efektif pada SKP ini (item terkunci). (083)';

create or replace function public.is_claim_document_special_uploader(
  p_campaign_id      uuid,
  p_document_type_id uuid,
  p_user_id          uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.claim_document_special_uploader_ids(p_campaign_id, p_document_type_id) as ids(id)
     where ids.id = p_user_id
  );
$$;

comment on function public.is_claim_document_special_uploader(uuid, uuid, uuid) is
  'true bila akun ini pengunggah khusus efektif untuk (SKP, jenis dokumen klaim). (083)';

create or replace function public.claim_document_has_file(
  p_campaign_id      uuid,
  p_document_type_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.campaign_files f
     where f.campaign_id = p_campaign_id
       and f.document_type_id = p_document_type_id
  );
$$;

comment on function public.claim_document_has_file(uuid, uuid) is
  'true bila SKP punya minimal satu file jenis dokumen klaim ini, dari pengunggah mana pun. (083)';

revoke all on function public.claim_document_special_uploader_ids(uuid, uuid) from public;
revoke all on function public.claim_document_is_locked(uuid, uuid) from public;
revoke all on function public.is_claim_document_special_uploader(uuid, uuid, uuid) from public;
revoke all on function public.claim_document_has_file(uuid, uuid) from public;
grant execute on function public.claim_document_special_uploader_ids(uuid, uuid) to authenticated, service_role;
grant execute on function public.claim_document_is_locked(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_claim_document_special_uploader(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.claim_document_has_file(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 2. campaign_files — item terkunci hanya oleh pengunggah khusus efektif
-- ============================================================
-- Sama dengan 072, ditambah syarat item terkunci di akhir.

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
    and (
      not public.claim_document_is_locked(campaign_files.campaign_id, campaign_files.document_type_id)
      or public.is_claim_document_special_uploader(
        campaign_files.campaign_id, campaign_files.document_type_id, (select auth.uid())
      )
    )
  );

-- ============================================================
-- 3. checklist — centang item terkunci hanya mengikuti file
-- ============================================================
-- Sama dengan 071, ditambah syarat item terkunci di WITH CHECK.

drop policy if exists "distributor_claim_checklists_insert" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_insert" on public.distributor_claim_checklists
  for insert to authenticated
  with check (
    distributor_id = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
    and (
      not public.claim_document_is_locked(
        distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
      )
      or distributor_claim_checklists.is_fulfilled = public.claim_document_has_file(
        distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
      )
    )
  );

drop policy if exists "distributor_claim_checklists_update" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_update" on public.distributor_claim_checklists
  for update to authenticated
  using (
    public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
  )
  with check (
    distributor_id = (select auth.uid())
    and public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) = 'act'
    and (
      not public.claim_document_is_locked(
        distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
      )
      or distributor_claim_checklists.is_fulfilled = public.claim_document_has_file(
        distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
      )
    )
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/083_claim_document_locked_items.sql      -- harus "SEMUA LOLOS"
-- \i supabase/tests/082_claim_document_type_uploaders.sql    -- penunjukan tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql      -- aturan lama tetap lolos

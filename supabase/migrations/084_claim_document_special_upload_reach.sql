-- 084: Pengunggah Khusus Dokumen Klaim — Fase 3
-- (plans/plan-pengunggah-khusus-dokumen-klaim.md)
-- Jangkauan lintas perusahaan: SKP anak perusahaan dan klaim turunan SKP
-- Nasional milik akun lain.
--
-- Lapis kedua (RLS) untuk aturan yang ditegakkan aplikasi di
-- lib/claim-document-uploaders.ts (specialUploaderReachError):
--
--   Pengunggah khusus efektif sebuah jenis dokumen MENJANGKAU sebuah SKP bila
--   SKP itu terlihat olehnya — 'act', atau 'view' karena SKP anak perusahaan,
--   atau 'view' karena klaim turunan milik akun lain — dan BUKAN SKP induk
--   nasional maupun klaim turunan yang dibatalkan.
--
-- Isi:
--   1. Fungsi claim_document_special_upload_reach(SKP, jenis dokumen): true
--      bila akun yang login pengunggah khusus efektif dan menjangkau SKP itu.
--   2. campaign_files_insert_distributor: item terkunci → cukup "menjangkau"
--      (tidak lagi menuntut 'act'); item tidak terkunci → aturan lama ('act').
--      Jendela status TIDAK berubah (Disetujui/Berjalan; Klaim Diajukan hanya
--      pemegang klaim saat revisi) — jendela sesudah submit menyusul di Fase 4.
--   3. distributor_claim_checklists insert/update: pengunggah khusus yang
--      menjangkau boleh menulis baris checklist dokumen terkuncinya walau
--      hanya bisa melihat SKP-nya, selama is_fulfilled = "ada file jenis itu"
--      (centang otomatis sesudah upload / lepas sesudah hapus). Baris dokumen
--      lain di SKP itu tetap menuntut 'act'.
--
-- Tidak berubah:
--   - Policy lihat SKP / file / checklist: pengunggah khusus sudah bisa melihat
--     SKP anak perusahaan (067) dan klaim turunan (077).
--   - Hapus file: campaign_files_delete (003) — pengunggahnya sendiri.
--   - Bucket campaign-documents: policy 003 sudah mengizinkan semua akun aktif,
--     dan aplikasi menulis objeknya lewat klien sistem setelah lolos pengaman
--     aplikasi — pengunggah khusus tidak terhalang di sana.
--
-- Selama belum ada penunjukan, fungsi baru selalu false dan semua policy
-- berperilaku persis seperti 083.
--
-- Aman dijalankan sebelum maupun sesudah push aplikasi Fase 3.
-- Prasyarat: migrasi 074–077, 082, 083 sudah dijalankan.

-- ============================================================
-- 1. FUNGSI
-- ============================================================

create or replace function public.claim_document_special_upload_reach(
  p_campaign_id      uuid,
  p_document_type_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_claim_document_special_uploader(
           p_campaign_id, p_document_type_id, (select auth.uid())
         )
     and exists (
       select 1
         from public.campaigns c
        where c.id = p_campaign_id
          -- SKP induk nasional tidak pernah menerima dokumen klaim
          and c.is_national is not true
          -- klaim turunan yang dibatalkan hanya bisa dilihat
          and not (c.parent_campaign_id is not null and c.status = 'cancelled')
          -- terlihat: 'act', atau 'view' (anak perusahaan / turunan akun lain)
          and public.distributor_campaign_access(c, public.distributor_viewer_ctx()) is not null
     );
$$;

comment on function public.claim_document_special_upload_reach(uuid, uuid) is
  'true bila akun yang login pengunggah khusus efektif untuk (SKP, jenis dokumen klaim) DAN menjangkau SKP itu: bertindak, atau hanya lihat karena SKP anak perusahaan / klaim turunan milik akun lain; tidak pernah induk nasional atau turunan yang dibatalkan. Padanan specialUploaderReachError di lib/claim-document-uploaders.ts. (084)';

revoke all on function public.claim_document_special_upload_reach(uuid, uuid) from public;
grant execute on function public.claim_document_special_upload_reach(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 2. campaign_files — item terkunci: cukup menjangkau
-- ============================================================
-- Sama dengan 083, kecuali syarat akses: (bertindak DAN tidak terkunci) ATAU
-- (pengunggah khusus yang menjangkau). Untuk SKP perusahaan sendiri hasilnya
-- identik dengan 083.

drop policy if exists "campaign_files_insert_distributor" on public.campaign_files;
create policy "campaign_files_insert_distributor" on public.campaign_files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and document_type_id is not null
    and (
      (
        public.distributor_campaign_access_by_id(
          campaign_files.campaign_id, (select public.distributor_viewer_ctx())
        ) = 'act'
        and not public.claim_document_is_locked(campaign_files.campaign_id, campaign_files.document_type_id)
      )
      or public.claim_document_special_upload_reach(
        campaign_files.campaign_id, campaign_files.document_type_id
      )
    )
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

-- ============================================================
-- 3. checklist — pengunggah khusus yang menjangkau, hanya dokumen terkuncinya
-- ============================================================
-- Sama dengan 083, ditambah cabang "pengunggah khusus yang menjangkau": hanya
-- untuk baris dokumen terkuncinya dan hanya bila is_fulfilled mengikuti file.

drop policy if exists "distributor_claim_checklists_insert" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_insert" on public.distributor_claim_checklists
  for insert to authenticated
  with check (
    distributor_id = (select auth.uid())
    and (
      (
        public.distributor_campaign_access_by_id(
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
      )
      or (
        public.claim_document_special_upload_reach(
          distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
        )
        and distributor_claim_checklists.is_fulfilled = public.claim_document_has_file(
          distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
        )
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
    or public.claim_document_special_upload_reach(
      distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
    )
  )
  with check (
    distributor_id = (select auth.uid())
    and (
      (
        public.distributor_campaign_access_by_id(
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
      )
      or (
        public.claim_document_special_upload_reach(
          distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
        )
        and distributor_claim_checklists.is_fulfilled = public.claim_document_has_file(
          distributor_claim_checklists.campaign_id, distributor_claim_checklists.document_type_id
        )
      )
    )
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/084_claim_document_special_upload_reach.sql  -- harus "SEMUA LOLOS"
-- \i supabase/tests/083_claim_document_locked_items.sql          -- item terkunci tetap lolos
-- \i supabase/tests/077_national_child_pusat_view.sql            -- akses turunan tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql          -- aturan lama tetap lolos

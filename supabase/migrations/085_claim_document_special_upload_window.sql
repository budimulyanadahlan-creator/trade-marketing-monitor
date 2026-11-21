-- 085: Pengunggah Khusus Dokumen Klaim — Fase 4
-- (plans/plan-pengunggah-khusus-dokumen-klaim.md)
-- Sesudah klaim diajukan: upload, ganti, dan hapus sampai Accept.
--
-- Lapis kedua (RLS) untuk aturan yang ditegakkan aplikasi di
-- lib/claim-document-uploaders.ts (specialDocumentWindowError):
--
--   Pengunggah khusus efektif boleh menambah file dokumen terkuncinya saat
--   SKP Disetujui / Berjalan, dan saat Klaim Diajukan selama item verifikasi
--   dokumen itu BELUM Accept — masih kosong (belum ada baris), menunggu
--   diperiksa, maupun diminta revisi. Kunci pemegang klaim tidak berlaku
--   baginya pada item ini. Status sesudah Klaim Diajukan tertutup.
--
-- Isi:
--   1. Fungsi claim_document_special_upload_open(SKP, jenis dokumen): true
--      bila akun yang login pengunggah khusus efektif, menjangkau SKP itu
--      (084), dan jendela statusnya terbuka.
--   2. campaign_files_insert_distributor: item terkunci → fungsi di atas;
--      item tidak terkunci → aturan lama persis (akses 'act', Disetujui /
--      Berjalan, atau Klaim Diajukan oleh pemegang klaim saat item diminta
--      revisi).
--
-- Tidak berubah:
--   - Policy checklist (084): pengunggah khusus yang menjangkau boleh menulis
--     baris checklist dokumen terkuncinya selama is_fulfilled mengikuti file —
--     tidak pernah dibatasi status, sama seperti cabang 'act'.
--   - Hapus file: campaign_files_delete (003) — pengunggahnya sendiri atau
--     admin, tanpa syarat status. Jendela hapus ditegakkan aplikasi
--     (DELETE /api/upload), sama seperti dokumen klaim lain sejak 072.
--   - Item verifikasi kembali ke "menunggu diperiksa" sesudah upload revisi:
--     ditulis aplikasi lewat klien sistem (resetClaimItemToPending).
--
-- Selama belum ada penunjukan, fungsi baru selalu false dan policy
-- berperilaku persis seperti 084.
--
-- Aman dijalankan sebelum maupun sesudah push aplikasi Fase 4.
-- Prasyarat: migrasi 039, 082, 083, 084 sudah dijalankan.

-- ============================================================
-- 1. FUNGSI
-- ============================================================

create or replace function public.claim_document_special_upload_open(
  p_campaign_id      uuid,
  p_document_type_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.claim_document_special_upload_reach(p_campaign_id, p_document_type_id)
     and exists (
       select 1
         from public.campaigns c
        where c.id = p_campaign_id
          and (
            c.status in ('approved', 'ongoing')
            or (
              c.status = 'claim_submitted'
              and not exists (
                select 1 from public.claim_item_verifications civ
                 where civ.campaign_id = c.id
                   and civ.document_type_id = p_document_type_id
                   and civ.status = 'accepted'
              )
            )
          )
     );
$$;

comment on function public.claim_document_special_upload_open(uuid, uuid) is
  'true bila akun yang login pengunggah khusus efektif yang menjangkau SKP ini (084) DAN jendela statusnya terbuka: Disetujui/Berjalan, atau Klaim Diajukan selama item verifikasi dokumen itu belum Accept. Padanan specialDocumentWindowError di lib/claim-document-uploaders.ts. (085)';

revoke all on function public.claim_document_special_upload_open(uuid, uuid) from public;
grant execute on function public.claim_document_special_upload_open(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 2. campaign_files — jendela status item terkunci
-- ============================================================
-- Cabang pertama = aturan lama untuk item TIDAK terkunci (identik dengan 084).
-- Cabang kedua = pengunggah khusus, dengan jendela statusnya sendiri.

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
      )
      or public.claim_document_special_upload_open(
        campaign_files.campaign_id, campaign_files.document_type_id
      )
    )
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/085_claim_document_special_upload_window.sql  -- harus "SEMUA LOLOS"
-- \i supabase/tests/084_claim_document_special_upload_reach.sql   -- jangkauan tetap lolos
-- \i supabase/tests/083_claim_document_locked_items.sql           -- item terkunci tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql           -- aturan lama tetap lolos

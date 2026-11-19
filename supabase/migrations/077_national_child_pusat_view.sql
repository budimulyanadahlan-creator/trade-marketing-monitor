-- 077: SKP Nasional — Fase 4 (plans/plan-skp-nasional.md)
-- Akun pusat melihat klaim turunan perusahaannya dan anak perusahaannya.
--
-- Isi:
--   1. distributor_campaign_access(campaigns, distributor_viewer): pada klaim
--      turunan, akun pusat perusahaan turunan dan akun pusat perusahaan
--      induknya → 'view' (semua region, termasuk turunan yang dibatalkan).
--      Pemilik tetap 'act' ('view' bila dibatalkan); akun lain — termasuk
--      cabang seperusahaan seregion dan cabang perusahaan induk — tetap tidak
--      melihat.
--
-- Akun pusat membuat klaim turunannya sendiri sudah berjalan sejak 075
-- (create_national_child_claim memakai region induk = National untuk akun
-- tanpa region), jadi tidak ada perubahan di fungsi itu.
--
-- Karena semua policy RLS tabel terkait klaim (campaigns, campaign_files,
-- checklist, riwayat klaim, verifikasi per item) memakai fungsi ini, akun
-- pusat otomatis bisa membaca data turunan itu dan tetap tidak bisa menulis
-- (policy tulis menuntut 'act').
--
-- Padanan sisi aplikasi: lib/distributor-campaign-guard.ts
-- (childClaimViewOnly).
--
-- Aman dijalankan sebelum maupun sesudah push aplikasi Fase 4: aplikasi lama
-- hanya akan menampilkan turunan itu ke akun pusat tanpa keterangan pemilik.
-- Prasyarat: migrasi 074, 075, 076 sudah dijalankan.

create or replace function public.distributor_campaign_access(
  c public.campaigns,
  v public.distributor_viewer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when c.is_national then
      case
        -- bukan distributor aktif / akun tanpa perusahaan
        when v.user_id is null or v.distributor_id is null then null
        -- jendela status yang terlihat distributor
        when c.status not in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed') then null
        -- hanya SKP Sales / Trade Marketing
        when not exists (
          select 1 from public.departments d
           where d.id = c.department_id
             and lower(trim(d.name)) in ('sales', 'trade marketing')
        ) then null
        -- semua perusahaan, semua region: hanya lihat, tidak pernah bertindak
        else 'view'
      end
    when c.parent_campaign_id is not null then
      case
        when v.user_id is null or v.distributor_id is null then null
        -- jendela status turunan: sama dengan SKP biasa + Dibatalkan (076)
        when c.status not in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed', 'cancelled') then null
        -- pemilik: bertindak; dibatalkan → jejaknya tetap terlihat, tanpa aksi
        when c.claim_owner_id = v.user_id then
          case when c.status = 'cancelled' then 'view' else 'act' end
        -- pusat perusahaan turunan / pusat perusahaan induknya: hanya lihat (077)
        when v.scope = 'pusat' and c.distributor_id is not null and (
          c.distributor_id = v.distributor_id
          or exists (
            select 1 from public.distributors d
             where d.id = c.distributor_id
               and d.parent_distributor_id = v.distributor_id
          )
        ) then 'view'
        -- akun lain: aturan region cabang tidak dipakai untuk turunan
        else null
      end
    else public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status, v)
  end;
$$;

comment on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) is
  'Akses distributor terhadap baris SKP: induk nasional → ''view'' untuk semua akun berperusahaan; klaim turunan → ''act'' untuk pemiliknya (''view'' bila dibatalkan) dan ''view'' untuk pusat perusahaan turunan / pusat perusahaan induknya; baris lain mengikuti aturan perusahaan/region (069). (074, 075, 076, 077)';

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/077_national_child_pusat_view.sql   -- harus "SEMUA LOLOS"
-- \i supabase/tests/076_national_child_cancel.sql       -- aturan batal tetap lolos
-- \i supabase/tests/075_national_child_claims.sql       -- aturan turunan tetap lolos
-- \i supabase/tests/074_national_campaign_access.sql    -- aturan induk tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql -- aturan lama tetap lolos

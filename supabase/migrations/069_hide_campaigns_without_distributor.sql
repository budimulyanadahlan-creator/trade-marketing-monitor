-- 069: Multi-User Distributor — Fase 6 (plans/plan-multi-user-distributor.md)
-- Sembunyikan SKP tanpa distributor dari semua distributor.
--
-- Mencabut pengecualian sementara di migrasi 067: SKP yang
-- campaigns.distributor_id-nya kosong dulu diperlakukan seperti SKP perusahaan
-- akun sendiri (cabang region sama / pusat semua region → 'act'). Setelah
-- backfill Fase 5 diterapkan (145 SKP terisi; tersisa 9 SKP yang memang
-- diputuskan "TANPA DISTRIBUTOR"), SKP tanpa distributor tidak lagi terlihat
-- dan tidak bisa dikerjakan oleh distributor mana pun, di semua jalur yang
-- memakai fungsi ini lewat RLS (campaigns, campaign_files,
-- distributor_claim_checklists, distributor_receipts, claim_events,
-- claim_item_verifications).
--
-- Padanan sisi aplikasi: lib/distributor-campaign-guard.ts (distributorActionDenial
-- mengembalikan "otherCompany" untuk SKP tanpa perusahaan).
--
-- Hanya fungsi ini yang berubah; signature tetap sama sehingga semua policy
-- RLS dan distributor_campaign_access_by_id (067) otomatis memakai aturan baru.
-- Prasyarat: migrasi 067 sudah dijalankan.

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
    -- SKP tanpa perusahaan distributor tidak terlihat siapa pun (Fase 6)
    when p_distributor_id is null then null
    -- jendela status yang terlihat distributor
    when p_status not in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed') then null
    -- hanya SKP Sales / Trade Marketing
    when not exists (
      select 1 from public.departments d
       where d.id = p_department_id
         and lower(trim(d.name)) in ('sales', 'trade marketing')
    ) then null
    -- perusahaan sama
    when p_distributor_id = v.distributor_id then
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

comment on function public.distributor_campaign_access(uuid, uuid, uuid, public.campaign_status, public.distributor_viewer) is
  'Akses distributor terhadap SKP: ''act'' (lihat & bertindak), ''view'' (hanya lihat, pusat induk), atau null (tidak terlihat). SKP tanpa distributor_id selalu null (069).';

-- Verifikasi cepat (jalankan terpisah setelah migrasi):
--   \i supabase/tests/067_distributor_campaign_access.sql
-- atau cek bahwa tidak ada SKP tanpa distributor yang terlihat:
--   select count(*) from public.campaigns c
--    where c.distributor_id is null
--      and public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status,
--            row(gen_random_uuid(), (select id from public.distributors limit 1), 'pusat', null)::public.distributor_viewer) is not null;
--   -- harus 0

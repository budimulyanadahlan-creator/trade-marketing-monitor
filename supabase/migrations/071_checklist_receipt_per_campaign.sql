-- 071: Multi-User Distributor — Fase 8 (plans/plan-multi-user-distributor.md)
-- Checklist dokumen klaim dan status penerimaan menjadi milik SKP, bukan akun.
--
-- Sebelumnya:
--   distributor_claim_checklists unik per (campaign_id, distributor_id, document_type_id)
--   distributor_receipts         unik per (campaign_id, received_by)
-- dan RLS distributor hanya menampilkan baris milik akun sendiri — staf B
-- melihat checklist kosong / SKP "belum diterima" padahal staf A (perusahaan
-- sama) sudah mengerjakannya, sementara Finance melihat gabungan semua akun.
--
-- Sesudahnya:
--   distributor_claim_checklists unik per (campaign_id, document_type_id);
--     kolom distributor_id diartikan "terakhir diubah oleh".
--   distributor_receipts unik per campaign_id; received_by = siapa yang menandai.
--   RLS distributor: semua akun yang boleh melihat SKP melihat baris yang
--   sama; yang boleh bertindak bisa menulis, dengan distributor_id /
--   received_by wajib = akun sendiri.
--
-- Penggabungan data lama:
--   checklist  → satu baris per (SKP, jenis dokumen); terpenuhi jika salah
--                satu akun memenuhinya (baris terpenuhi + terbaru dipertahankan).
--   penerimaan → baris paling awal (received_at) per SKP dipertahankan.

-- ============================================================
-- 1. distributor_claim_checklists: gabungkan + unik per SKP
-- ============================================================

with ranked as (
  select id,
         row_number() over (
           partition by campaign_id, document_type_id
           order by is_fulfilled desc, updated_at desc, id
         ) as rn
  from public.distributor_claim_checklists
)
delete from public.distributor_claim_checklists d
using ranked r
where d.id = r.id
  and r.rn > 1;

-- Nama constraint unik bawaan (023) terpotong 63 karakter — cari lewat katalog.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.distributor_claim_checklists'::regclass
      and contype = 'u'
  loop
    execute format('alter table public.distributor_claim_checklists drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.distributor_claim_checklists
  add constraint distributor_claim_checklists_campaign_doc_key
  unique (campaign_id, document_type_id);

comment on column public.distributor_claim_checklists.distributor_id is
  'Akun yang terakhir mengubah item checklist (Fase 8: checklist milik SKP, bukan akun).';

-- ============================================================
-- 2. distributor_receipts: gabungkan + unik per SKP
-- ============================================================

with ranked as (
  select id,
         row_number() over (
           partition by campaign_id
           order by received_at asc, created_at asc, id
         ) as rn
  from public.distributor_receipts
)
delete from public.distributor_receipts d
using ranked r
where d.id = r.id
  and r.rn > 1;

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.distributor_receipts'::regclass
      and contype = 'u'
  loop
    execute format('alter table public.distributor_receipts drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.distributor_receipts
  add constraint distributor_receipts_campaign_key
  unique (campaign_id);

-- ============================================================
-- 3. RLS checklist: baris SKP terlihat untuk semua akun yang boleh melihat
-- ============================================================

drop policy if exists "distributor_claim_checklists_select_distributor" on public.distributor_claim_checklists;
create policy "distributor_claim_checklists_select_distributor" on public.distributor_claim_checklists
  for select to authenticated
  using (
    public.distributor_campaign_access_by_id(
      distributor_claim_checklists.campaign_id, (select public.distributor_viewer_ctx())
    ) is not null
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

-- USING tanpa syarat pemilik baris: rekan satu perusahaan boleh mengubah
-- item yang dibuat akun lain. WITH CHECK memastikan "terakhir diubah oleh"
-- diisi akun sendiri.
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
  );

-- ============================================================
-- 4. RLS penerimaan: status diterima terlihat untuk semua akun yang boleh melihat
-- ============================================================
-- Policy insert (067) tetap: received_by = akun sendiri + boleh bertindak +
-- status approved; keunikan per SKP kini dijaga constraint di atas.

drop policy if exists "distributor_receipts_select_own" on public.distributor_receipts;
create policy "distributor_receipts_select_own" on public.distributor_receipts
  for select to authenticated
  using (
    public.distributor_campaign_access_by_id(
      distributor_receipts.campaign_id, (select public.distributor_viewer_ctx())
    ) is not null
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- select campaign_id, document_type_id, count(*) from public.distributor_claim_checklists
--   group by 1, 2 having count(*) > 1;
-- -- diharapkan: 0 baris
-- select campaign_id, count(*) from public.distributor_receipts
--   group by 1 having count(*) > 1;
-- -- diharapkan: 0 baris
-- select conname from pg_constraint
--   where conrelid in ('public.distributor_claim_checklists'::regclass,
--                      'public.distributor_receipts'::regclass)
--     and contype = 'u';
-- -- diharapkan: distributor_claim_checklists_campaign_doc_key, distributor_receipts_campaign_key

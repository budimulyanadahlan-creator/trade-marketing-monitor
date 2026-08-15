-- Phase 1 (Bukti Eksekusi & Klaim Online): dokumen klaim per item checklist
-- + perbaikan akses distributor yang jadi prasyarat wajib fitur ini.
--
-- 1. campaigns_select_distributor: perluas status = 'approved' menjadi
--    approved/ongoing/claim_submitted/paid/completed — tanpa perbaikan ini
--    distributor kehilangan akses ke SKP-nya begitu status meninggalkan
--    'approved', dan seluruh alur klaim (upload dokumen, submit, batal)
--    tidak akan berfungsi.
-- 2. campaign_files_select_distributor: perluas jendela status yang sama.
--    Migration 015 juga masih mensyaratkan c.region_id = u.region_id, gate
--    yang sudah dihapus untuk campaigns_select_distributor di migration 025
--    ("distributors are not region-locked for viewing") tapi tidak pernah
--    ikut dihapus di sini. Tanpa ikut dihapus, distributor tidak akan bisa
--    melihat/mengunduh dokumen klaim yang baru saja mereka unggah sendiri
--    untuk SKP di luar region mereka — jadi ikut diperbaiki di sini supaya
--    konsisten dengan 025 dan fitur upload di bawah benar-benar berfungsi.
-- 3. campaign_files_insert_distributor: policy INSERT baru — distributor
--    bukan created_by campaign manapun, jadi tanpa policy ini mereka tidak
--    bisa mengupload dokumen klaim sama sekali.
-- 4. campaign_files.document_type_id: kolom baru (nullable FK ke
--    claim_document_types). Terisi = dokumen klaim; NULL = lampiran SKP
--    biasa seperti sebelumnya.

drop policy if exists "campaigns_select_distributor" on public.campaigns;

create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    campaigns.status in ('approved', 'ongoing', 'claim_submitted', 'paid', 'completed')
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
        and c.status in ('approved', 'ongoing', 'claim_submitted', 'paid', 'completed')
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

alter table public.campaign_files
  add column if not exists document_type_id uuid references public.claim_document_types(id) on delete set null;

drop policy if exists "campaign_files_insert_distributor" on public.campaign_files;

create policy "campaign_files_insert_distributor" on public.campaign_files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and document_type_id is not null
    and exists (
      select 1
      from public.campaigns c
      join public.users u on u.id = auth.uid()
      where c.id = campaign_files.campaign_id
        and c.status in ('approved', 'ongoing', 'claim_submitted')
        and u.role = 'distributor'
        and u.is_active = true
    )
  );

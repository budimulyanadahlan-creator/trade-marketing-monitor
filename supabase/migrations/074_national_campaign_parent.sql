-- 074: SKP Nasional — Fase 1 (plans/plan-skp-nasional.md)
-- SKP induk nasional terlihat semua distributor.
--
-- Isi:
--   1. Kolom campaigns.is_national + constraint bentuk baris induk.
--   2. Trigger campaigns_guard_national: hanya admin/superadmin (atau hak
--      layanan / SQL editor) yang boleh mengubah tanda; induk wajib ber-region
--      National; SKP yang sudah punya aktivitas klaim tidak bisa dijadikan
--      nasional.
--   3. Trigger pada realizations, distributor_claim_checklists,
--      distributor_receipts, campaign_files: induk nasional menolak realisasi,
--      checklist, tanda terima, dan dokumen klaim.
--   4. Fungsi akses versi per baris SKP:
--        distributor_campaign_access(campaigns, distributor_viewer)
--      Induk nasional → 'view' untuk semua akun distributor aktif
--      berperusahaan (status Disetujui s.d. Selesai, departemen Sales/TM);
--      baris lain diteruskan ke fungsi 5 argumen (067/069) tanpa perubahan
--      aturan. Fase berikutnya (klaim turunan) cukup mengubah fungsi ini.
--   5. Policy RLS campaigns + claim_item_verifications dan
--      distributor_campaign_access_by_id dipindah ke fungsi per baris.
--      Policy tabel anak (file, checklist, tanda terima, riwayat klaim)
--      memakai _by_id sehingga ikut aturan baru tanpa diubah.
--
-- Padanan sisi aplikasi: lib/distributor-campaign-guard.ts (akses) dan
-- lib/national-skp.ts (syarat Jadikan/Batalkan Nasional, penolakan aktivitas).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 1: aplikasi memilih kolom
-- campaigns.is_national. Aman untuk aplikasi lama: belum ada baris nasional,
-- jadi semua aturan lama berlaku persis seperti sebelumnya.
-- Prasyarat: migrasi 067, 069, 072 sudah dijalankan.

-- ============================================================
-- 1. KOLOM + BENTUK BARIS INDUK
-- ============================================================

alter table public.campaigns
  add column if not exists is_national boolean not null default false;

comment on column public.campaigns.is_national is
  'SKP induk nasional (074): terlihat semua distributor, tanpa distributor, region National, tidak menerima aktivitas klaim.';

-- Induk: tanpa distributor dan tidak pernah masuk siklus klaim. Region
-- National diperiksa trigger di bawah (CHECK tidak bisa melihat tabel lain).
alter table public.campaigns
  drop constraint if exists campaigns_national_parent_shape;

alter table public.campaigns
  add constraint campaigns_national_parent_shape
  check (
    not is_national
    or (
      distributor_id is null
      and status not in ('ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid')
      and claim_amount is null
      and claim_submitted_by is null
    )
  );

-- ============================================================
-- 2. TRIGGER campaigns: siapa boleh menandai, region, aktivitas klaim
-- ============================================================

create or replace function public.campaigns_guard_national()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_changed   boolean;
  v_blockers  text[] := '{}';
begin
  v_changed := (tg_op = 'INSERT' and new.is_national)
            or (tg_op = 'UPDATE' and new.is_national is distinct from old.is_national);

  -- Tanda nasional hanya boleh diubah admin/superadmin. auth.uid() kosong =
  -- hak layanan / SQL editor (script aktivasi Fase 10) → diizinkan.
  if v_changed and v_uid is not null and not exists (
    select 1 from public.users u
     where u.id = v_uid
       and u.role in ('admin', 'superadmin')
       and u.is_active = true
  ) then
    raise exception 'Hanya admin yang dapat mengubah tanda SKP Nasional'
      using errcode = '42501';
  end if;

  if not new.is_national then
    return new;
  end if;

  if not exists (
    select 1 from public.regions r
     where r.id = new.region_id
       and lower(trim(r.name)) = 'national'
  ) then
    raise exception 'SKP Nasional harus ber-region National'
      using errcode = '23514';
  end if;

  -- SKP biasa → nasional: tidak boleh sudah punya aktivitas klaim.
  if tg_op = 'UPDATE' and not old.is_national then
    if exists (select 1 from public.claim_events e where e.campaign_id = new.id) then
      v_blockers := array_append(v_blockers, 'klaim');
    end if;
    if exists (select 1 from public.distributor_claim_checklists k
                where k.campaign_id = new.id and k.is_fulfilled) then
      v_blockers := array_append(v_blockers, 'checklist terisi');
    end if;
    if exists (select 1 from public.campaign_files f
                where f.campaign_id = new.id and f.document_type_id is not null) then
      v_blockers := array_append(v_blockers, 'dokumen klaim');
    end if;
    if exists (select 1 from public.distributor_receipts t where t.campaign_id = new.id) then
      v_blockers := array_append(v_blockers, 'tanda terima');
    end if;
    if exists (select 1 from public.realizations z where z.campaign_id = new.id) then
      v_blockers := array_append(v_blockers, 'realisasi');
    end if;

    if array_length(v_blockers, 1) > 0 then
      raise exception 'SKP tidak dapat dijadikan Nasional karena sudah punya %',
        array_to_string(v_blockers, ', ')
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_guard_national on public.campaigns;
create trigger campaigns_guard_national
  before insert or update on public.campaigns
  for each row execute function public.campaigns_guard_national();

-- ============================================================
-- 3. INDUK NASIONAL MENOLAK AKTIVITAS KLAIM
-- ============================================================

create or replace function public.reject_national_parent_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- campaign_files: lampiran SKP biasa (tanpa jenis dokumen klaim) tetap boleh.
  if tg_table_name = 'campaign_files'
     and (to_jsonb(new) ->> 'document_type_id') is null then
    return new;
  end if;

  if exists (
    select 1 from public.campaigns c
     where c.id = new.campaign_id
       and c.is_national
  ) then
    raise exception 'SKP Nasional tidak menerima realisasi, klaim, checklist, dokumen klaim, atau tanda terima secara langsung (%)',
      tg_table_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_national_parent_activity on public.realizations;
create trigger reject_national_parent_activity
  before insert or update on public.realizations
  for each row execute function public.reject_national_parent_activity();

drop trigger if exists reject_national_parent_activity on public.distributor_claim_checklists;
create trigger reject_national_parent_activity
  before insert or update on public.distributor_claim_checklists
  for each row execute function public.reject_national_parent_activity();

drop trigger if exists reject_national_parent_activity on public.distributor_receipts;
create trigger reject_national_parent_activity
  before insert or update on public.distributor_receipts
  for each row execute function public.reject_national_parent_activity();

drop trigger if exists reject_national_parent_activity on public.campaign_files;
create trigger reject_national_parent_activity
  before insert or update on public.campaign_files
  for each row execute function public.reject_national_parent_activity();

-- ============================================================
-- 4. FUNGSI AKSES PER BARIS SKP
-- ============================================================

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
    else public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status, v)
  end;
$$;

comment on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) is
  'Akses distributor terhadap baris SKP: induk nasional → ''view'' untuk semua akun berperusahaan; baris lain mengikuti aturan perusahaan/region (069). (074)';

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
  select public.distributor_campaign_access(c, v)
    from public.campaigns c
   where c.id = p_campaign_id;
$$;

revoke all on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) from public;
grant execute on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) to authenticated;

-- ============================================================
-- 5. POLICY campaigns → fungsi per baris
-- (definisi sama dengan 067/072, hanya pemanggilan fungsinya yang berubah)
-- ============================================================

drop policy if exists "campaigns_select_distributor" on public.campaigns;
create policy "campaigns_select_distributor" on public.campaigns
  for select to authenticated
  using (
    public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) is not null
  );

-- Submit klaim: ongoing → claim_submitted; pengaju = pemegang (072)
drop policy if exists "campaigns_update_distributor_claim" on public.campaigns;
create policy "campaigns_update_distributor_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'ongoing'
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  )
  with check (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  );

-- Batal klaim: hanya pemegang (072)
drop policy if exists "campaigns_update_distributor_cancel_claim" on public.campaigns;
create policy "campaigns_update_distributor_cancel_claim" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  )
  with check (
    campaigns.status = 'ongoing'
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  );

-- Ubah nominal: hanya pemegang, pemegang tidak berubah (072)
drop policy if exists "campaigns_update_distributor_edit_claim_amount" on public.campaigns;
create policy "campaigns_update_distributor_edit_claim_amount" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  )
  with check (
    campaigns.status = 'claim_submitted'
    and campaigns.claim_submitted_by = (select auth.uid())
    and public.distributor_campaign_access(campaigns, (select public.distributor_viewer_ctx())) = 'act'
  );

-- claim_item_verifications (067 §8)
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
            and public.distributor_campaign_access(c, (select public.distributor_viewer_ctx())) is not null
          )
        )
    )
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/074_national_campaign_access.sql   -- harus "SEMUA LOLOS"
-- \i supabase/tests/067_distributor_campaign_access.sql -- aturan lama tetap lolos
--
-- select policyname from pg_policies
--  where schemaname = 'public' and tablename = 'campaigns'
--    and (qual ilike '%distributor_campaign_access%' or with_check ilike '%distributor_campaign_access%')
--  order by 1;
-- -- diharapkan 4 baris: campaigns_select_distributor + 3 policy update klaim.
--
-- select count(*) from public.campaigns where is_national;
-- -- diharapkan 0 sampai admin menekan "Jadikan Nasional" / Fase 10.

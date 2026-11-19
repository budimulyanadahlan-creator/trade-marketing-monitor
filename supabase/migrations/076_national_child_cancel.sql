-- 076: SKP Nasional — Fase 3 (plans/plan-skp-nasional.md)
-- Klaim berulang dan pembatalan klaim turunan.
--
-- Klaim berulang sudah berjalan sejak 075 (create_national_child_claim hanya
-- menolak bila akun masih punya turunan Disetujui/Berjalan, dan nomor urut
-- diambil dari max(child_seq) sehingga nomor turunan yang dibatalkan tidak
-- dipakai ulang). Migrasi ini menambah pembatalan.
--
-- Isi:
--   1. claim_events: action baru 'child_cancelled' (jejak siapa membatalkan
--      klaim turunan dan kapan). Hanya ditulis fungsi di butir 5; pengguna
--      login tidak bisa menyisipkannya lewat PostgREST.
--   2. Trigger campaigns_guard_national_child: klaim turunan hanya bisa
--      menjadi Dibatalkan dari status Disetujui dan tanpa realisasi; turunan
--      yang sudah Dibatalkan tidak bisa diaktifkan kembali. (Aturan lain sama
--      dengan 075.)
--   3. reject_national_parent_activity: klaim turunan yang dibatalkan menolak
--      realisasi baru. (Aturan lain sama dengan 075.)
--   4. distributor_campaign_access(campaigns, distributor_viewer): turunan
--      yang dibatalkan → 'view' untuk pemiliknya (tetap terlihat, tanpa aksi).
--   5. cancel_national_child_claim(p_child_id, p_actor_id): membatalkan klaim
--      turunan dengan baris klaim dikunci, agar tidak berpapasan dengan
--      pencatatan realisasi. Hanya untuk service_role — dipanggil
--      cancelChildClaimAction.
--
-- Padanan sisi aplikasi: lib/national-skp.ts (cancelChildClaimError) dan
-- lib/distributor-campaign-guard.ts (akses turunan dibatalkan).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 3: aplikasi memanggil fungsi
-- cancel_national_child_claim. Aman untuk aplikasi lama: belum ada turunan
-- berstatus Dibatalkan, jadi semua aturan lama berlaku persis seperti
-- sebelumnya.
-- Prasyarat: migrasi 073, 074, 075 sudah dijalankan.

-- ============================================================
-- 1. RIWAYAT KLAIM: action 'child_cancelled'
-- ============================================================

alter table public.claim_events
  drop constraint if exists claim_events_action_check;

alter table public.claim_events
  add constraint claim_events_action_check
  check (action in (
    'submitted', 'cancelled', 'claim_verified', 'ready_to_pay',
    'item_accepted', 'item_revision_requested', 'holder_transferred',
    'child_cancelled'
  ));

-- Definisi sama dengan 073, ditambah: 'child_cancelled' tidak pernah bisa
-- disisipkan pengguna login (hanya fungsi cancel_national_child_claim, yang
-- berjalan dengan hak layanan dan melewati RLS).
drop policy if exists "claim_events_insert" on public.claim_events;
create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and claim_events.action <> 'child_cancelled'
    and (
      exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role in ('finance', 'admin', 'superadmin')
          and u.is_active = true
          and (claim_events.action <> 'holder_transferred' or u.role in ('admin', 'superadmin'))
      )
      or (
        claim_events.action <> 'holder_transferred'
        and public.distributor_campaign_access_by_id(
          claim_events.campaign_id, (select public.distributor_viewer_ctx())
        ) = 'act'
      )
    )
  );

-- ============================================================
-- 2. TRIGGER campaigns: penjaga baris turunan + peralihan Dibatalkan
-- ============================================================

create or replace function public.campaigns_guard_national_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.parent_campaign_id is null then
      return new;
    end if;

    -- auth.uid() kosong = hak layanan (create_national_child_claim) / SQL
    -- editor. Pengguna login tidak pernah menyisipkan turunan secara langsung.
    if v_uid is not null then
      raise exception 'Klaim turunan hanya dapat dibuat lewat tombol Buat Klaim pada SKP Nasional'
        using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.campaigns p
       where p.id = new.parent_campaign_id
         and p.is_national
         and p.parent_campaign_id is null
    ) then
      raise exception 'Induk klaim turunan harus SKP Nasional'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- UPDATE
  if new.parent_campaign_id is distinct from old.parent_campaign_id
     or new.child_seq is distinct from old.child_seq then
    raise exception 'SKP induk dan nomor urut klaim turunan tidak dapat diubah'
      using errcode = '23514';
  end if;

  if new.claim_owner_id is distinct from old.claim_owner_id
     and v_uid is not null
     and not exists (
       select 1 from public.users u
        where u.id = v_uid
          and u.role in ('admin', 'superadmin')
          and u.is_active = true
     ) then
    raise exception 'Hanya admin yang dapat mengalihkan pemilik klaim turunan'
      using errcode = '42501';
  end if;

  if old.is_national and not new.is_national and exists (
    select 1 from public.campaigns k where k.parent_campaign_id = new.id
  ) then
    raise exception 'Tanda Nasional tidak dapat dicabut karena SKP ini sudah punya klaim turunan'
      using errcode = '23514';
  end if;

  -- Pembatalan klaim turunan (076): hanya dari Disetujui dan tanpa realisasi;
  -- yang sudah Dibatalkan tidak diaktifkan kembali (akun itu mungkin sudah
  -- membuat klaim pengganti).
  if new.parent_campaign_id is not null and new.status is distinct from old.status then
    if old.status = 'cancelled' then
      raise exception 'Klaim yang sudah dibatalkan tidak dapat diaktifkan kembali — buat klaim baru dari SKP Nasional'
        using errcode = '23514';
    end if;

    if new.status = 'cancelled' then
      if old.status <> 'approved' then
        raise exception 'Klaim hanya dapat dibatalkan selama berstatus Disetujui (belum ada realisasi dan belum diajukan)'
          using errcode = '23514';
      end if;
      if exists (select 1 from public.realizations z where z.campaign_id = new.id) then
        raise exception 'Klaim tidak dapat dibatalkan karena sudah punya realisasi'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. TURUNAN DIBATALKAN MENOLAK REALISASI
-- (induk dan tanda terima: definisi sama dengan 075)
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

  if tg_table_name = 'distributor_receipts' and exists (
    select 1 from public.campaigns c
     where c.id = new.campaign_id
       and c.parent_campaign_id is not null
  ) then
    raise exception 'Klaim SKP Nasional tidak memakai tanda terima'
      using errcode = '23514';
  end if;

  if tg_table_name = 'realizations' and exists (
    select 1 from public.campaigns c
     where c.id = new.campaign_id
       and c.parent_campaign_id is not null
       and c.status = 'cancelled'
  ) then
    raise exception 'Klaim ini sudah dibatalkan — realisasi tidak dapat dicatat'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 4. FUNGSI AKSES PER BARIS SKP: turunan dibatalkan → hanya lihat
-- (cabang induk nasional dan baris lain sama dengan 075)
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
    when c.parent_campaign_id is not null then
      case
        when v.user_id is null or v.distributor_id is null then null
        -- kuncinya pemilik; aturan perusahaan/region tidak dipakai
        when c.claim_owner_id is distinct from v.user_id then null
        -- dibatalkan: jejaknya tetap terlihat pemilik, tanpa aksi (076)
        when c.status = 'cancelled' then 'view'
        when c.status in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed') then 'act'
        else null
      end
    else public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status, v)
  end;
$$;

comment on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) is
  'Akses distributor terhadap baris SKP: induk nasional → ''view'' untuk semua akun berperusahaan; klaim turunan → ''act'' hanya untuk pemiliknya (''view'' bila dibatalkan); baris lain mengikuti aturan perusahaan/region (069). (074, 075, 076)';

-- ============================================================
-- 5. BATALKAN KLAIM TURUNAN
-- ============================================================

create or replace function public.cancel_national_child_claim(
  p_child_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.campaigns;
  v_actor public.users;
begin
  -- Kunci baris klaim: pencatatan realisasi (FK ke baris ini) diantrekan di
  -- belakang pembatalan, lalu ditolak trigger di butir 3.
  select * into v_child
    from public.campaigns
   where id = p_child_id
     for update;

  if not found then
    raise exception 'Klaim tidak ditemukan' using errcode = 'P0001';
  end if;
  if v_child.parent_campaign_id is null then
    raise exception 'Hanya klaim atas SKP Nasional yang dapat dibatalkan lewat tombol ini' using errcode = 'P0001';
  end if;

  select * into v_actor from public.users where id = p_actor_id;

  if not found or not v_actor.is_active then
    raise exception 'Akun tidak aktif' using errcode = 'P0001';
  end if;
  if not (
    v_actor.role::text in ('admin', 'superadmin')
    or (v_actor.role::text = 'distributor' and v_child.claim_owner_id = p_actor_id)
  ) then
    raise exception 'Hanya pemilik klaim atau admin yang dapat membatalkan klaim ini' using errcode = 'P0001';
  end if;

  if v_child.status = 'cancelled' then
    raise exception 'Klaim ini sudah dibatalkan' using errcode = 'P0001';
  end if;
  if v_child.status = 'ongoing'
     or exists (select 1 from public.realizations z where z.campaign_id = p_child_id) then
    raise exception 'Klaim tidak dapat dibatalkan karena sudah punya realisasi — hubungi Finance' using errcode = 'P0001';
  end if;
  if v_child.status <> 'approved' then
    raise exception 'Klaim yang sudah diajukan tidak dapat dibatalkan di sini — gunakan Batalkan Pengajuan selama klaim belum disetujui' using errcode = 'P0001';
  end if;

  update public.campaigns set status = 'cancelled' where id = p_child_id;

  insert into public.claim_events (campaign_id, actor_id, action)
  values (p_child_id, p_actor_id, 'child_cancelled');
end;
$$;

comment on function public.cancel_national_child_claim(uuid, uuid) is
  'Membatalkan klaim turunan SKP nasional (pemilik atau admin; hanya Disetujui tanpa realisasi) dan mencatatnya di riwayat klaim. Hanya service_role. (076)';

revoke all on function public.cancel_national_child_claim(uuid, uuid) from public;
revoke all on function public.cancel_national_child_claim(uuid, uuid) from anon, authenticated;
grant execute on function public.cancel_national_child_claim(uuid, uuid) to service_role;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/076_national_child_cancel.sql       -- harus "SEMUA LOLOS"
-- \i supabase/tests/075_national_child_claims.sql       -- aturan turunan tetap lolos
-- \i supabase/tests/074_national_campaign_access.sql    -- aturan induk tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql -- aturan lama tetap lolos
--
-- select count(*) from public.campaigns
--  where parent_campaign_id is not null and status = 'cancelled';
-- -- diharapkan 0 sampai ada klaim turunan yang dibatalkan.

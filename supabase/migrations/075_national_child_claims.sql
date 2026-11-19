-- 075: SKP Nasional — Fase 2 (plans/plan-skp-nasional.md)
-- Klaim turunan: baris SKP biasa yang menunjuk ke SKP induk nasional dan
-- dikunci ke akun pembuatnya.
--
-- Isi:
--   1. Kolom campaigns.parent_campaign_id, claim_owner_id, child_seq +
--      constraint bentuk baris turunan + nomor urut unik per induk.
--   2. Trigger campaigns_guard_national_child: turunan hanya bisa dibuat
--      dengan hak layanan (fungsi di bawah / SQL editor), induknya harus SKP
--      nasional yang bukan turunan, penunjuk induk dan nomor urut tidak bisa
--      diubah, pemilik hanya bisa diubah admin, dan tanda nasional tidak bisa
--      dicabut dari induk yang sudah punya turunan.
--   3. reject_national_parent_activity: klaim turunan juga menolak tanda
--      terima (induk tetap menolak semua aktivitas klaim).
--   4. distributor_campaign_access(campaigns, distributor_viewer): turunan →
--      'act' hanya untuk pemiliknya; akun lain (termasuk cabang seperusahaan
--      seregion) tidak melihat. Akses pusat menyusul di Fase 4.
--   5. create_national_child_claim(p_parent_id, p_owner_id): membuat klaim
--      turunan dengan nomor urut yang dialokasikan atomik (induk dikunci).
--      Hanya untuk service_role — dipanggil createChildClaimAction.
--
-- Padanan sisi aplikasi: lib/distributor-campaign-guard.ts (akses) dan
-- lib/national-skp.ts (syarat Buat Klaim, nomor, nama).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 2: aplikasi memilih kolom baru
-- dan memanggil fungsi create_national_child_claim. Aman untuk aplikasi lama:
-- belum ada baris turunan, jadi semua aturan lama berlaku persis seperti
-- sebelumnya.
-- Prasyarat: migrasi 074 sudah dijalankan.

-- ============================================================
-- 1. KOLOM + BENTUK BARIS TURUNAN
-- ============================================================

alter table public.campaigns
  add column if not exists parent_campaign_id uuid references public.campaigns(id) on delete restrict,
  add column if not exists claim_owner_id     uuid references public.users(id),
  add column if not exists child_seq          integer;

comment on column public.campaigns.parent_campaign_id is
  'Klaim turunan SKP nasional (075): SKP induk yang menjadi dasar klaim. NULL untuk SKP biasa dan induk.';
comment on column public.campaigns.claim_owner_id is
  'Pemilik klaim turunan (075): satu-satunya akun distributor yang boleh mengerjakannya.';
comment on column public.campaigns.child_seq is
  'Nomor urut klaim turunan per induk (075); membentuk akhiran -K01, -K02, … pada skp_number.';

-- Turunan: punya induk, pemilik, perusahaan, nomor urut; nilai SKP 0 (komitmen
-- hanya di induk); tanpa No surat (kolom itu unik, No surat ada di induk);
-- bukan induk nasional. Baris lain: ketiga kolom kosong.
alter table public.campaigns
  drop constraint if exists campaigns_national_child_shape;

alter table public.campaigns
  add constraint campaigns_national_child_shape
  check (
    (
      parent_campaign_id is null
      and claim_owner_id is null
      and child_seq is null
    )
    or (
      parent_campaign_id is not null
      and parent_campaign_id <> id
      and not is_national
      and claim_owner_id is not null
      and distributor_id is not null
      and child_seq is not null
      and child_seq > 0
      and requested_budget = 0
      and reference_number is null
    )
  );

create unique index if not exists campaigns_parent_child_seq_unique
  on public.campaigns (parent_campaign_id, child_seq)
  where parent_campaign_id is not null;

create index if not exists campaigns_parent_owner_idx
  on public.campaigns (parent_campaign_id, claim_owner_id)
  where parent_campaign_id is not null;

-- ============================================================
-- 2. TRIGGER campaigns: penjaga baris turunan
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

  return new;
end;
$$;

drop trigger if exists campaigns_guard_national_child on public.campaigns;
create trigger campaigns_guard_national_child
  before insert or update on public.campaigns
  for each row execute function public.campaigns_guard_national_child();

-- ============================================================
-- 3. TANDA TERIMA TIDAK BERLAKU UNTUK TURUNAN
-- (induk: definisi sama dengan 074)
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

  return new;
end;
$$;

-- ============================================================
-- 4. FUNGSI AKSES PER BARIS SKP: cabang aturan klaim turunan
-- (cabang induk nasional dan baris lain sama dengan 074)
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
        when c.status not in ('approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed') then null
        -- kuncinya pemilik; aturan perusahaan/region tidak dipakai
        when c.claim_owner_id = v.user_id then 'act'
        else null
      end
    else public.distributor_campaign_access(c.distributor_id, c.region_id, c.department_id, c.status, v)
  end;
$$;

comment on function public.distributor_campaign_access(public.campaigns, public.distributor_viewer) is
  'Akses distributor terhadap baris SKP: induk nasional → ''view'' untuk semua akun berperusahaan; klaim turunan → ''act'' hanya untuk pemiliknya; baris lain mengikuti aturan perusahaan/region (069). (074, 075)';

-- ============================================================
-- 5. BUAT KLAIM TURUNAN (nomor urut atomik)
-- ============================================================

create or replace function public.create_national_child_claim(
  p_parent_id uuid,
  p_owner_id  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent   public.campaigns;
  v_owner    public.users;
  v_seq      integer;
  v_owner_no integer;
  v_id       uuid;
begin
  -- Kunci baris induk: dua akun yang menekan "Buat Klaim" bersamaan
  -- diantrekan di sini sehingga nomor urutnya berbeda.
  select * into v_parent
    from public.campaigns
   where id = p_parent_id
     for update;

  if not found then
    raise exception 'SKP tidak ditemukan' using errcode = 'P0001';
  end if;
  if not v_parent.is_national or v_parent.parent_campaign_id is not null then
    raise exception 'SKP ini bukan SKP Nasional' using errcode = 'P0001';
  end if;
  if v_parent.status <> 'approved' then
    raise exception 'Klaim hanya dapat dibuat pada SKP Nasional berstatus Disetujui' using errcode = 'P0001';
  end if;
  if v_parent.skp_number is null then
    raise exception 'SKP Nasional ini belum bernomor — hubungi admin Marmot' using errcode = 'P0001';
  end if;

  select * into v_owner from public.users where id = p_owner_id;

  if not found or v_owner.role::text <> 'distributor' then
    raise exception 'Hanya akun distributor yang dapat membuat klaim atas SKP Nasional' using errcode = 'P0001';
  end if;
  if not v_owner.is_active then
    raise exception 'Akun tidak aktif' using errcode = 'P0001';
  end if;
  if v_owner.distributor_id is null then
    raise exception 'Akun Anda belum terhubung ke perusahaan distributor' using errcode = 'P0001';
  end if;

  -- Satu klaim yang belum diajukan per akun per induk.
  if exists (
    select 1 from public.campaigns k
     where k.parent_campaign_id = p_parent_id
       and k.claim_owner_id = p_owner_id
       and k.status in ('approved', 'ongoing')
  ) then
    raise exception 'Selesaikan atau batalkan klaim Anda yang belum diajukan sebelum membuat klaim baru'
      using errcode = 'P0001';
  end if;

  select coalesce(max(k.child_seq), 0) + 1 into v_seq
    from public.campaigns k
   where k.parent_campaign_id = p_parent_id;

  select count(*) + 1 into v_owner_no
    from public.campaigns k
   where k.parent_campaign_id = p_parent_id
     and k.claim_owner_id = p_owner_id;

  insert into public.campaigns (
    name,
    department_id, brand_id, channel_id, promotion_category_id, action_approval_id,
    start_date, end_date, objective, mechanism,
    distributor_id, region_id,
    requested_budget, status, created_by, submitted_at,
    skp_number, parent_campaign_id, claim_owner_id, child_seq
  ) values (
    v_parent.name || ' – klaim ' || coalesce(nullif(trim(v_owner.full_name), ''), 'akun distributor')
      || case when v_owner_no > 1 then ' (' || v_owner_no || ')' else '' end,
    v_parent.department_id, v_parent.brand_id, v_parent.channel_id,
    v_parent.promotion_category_id, v_parent.action_approval_id,
    v_parent.start_date, v_parent.end_date, v_parent.objective, v_parent.mechanism,
    v_owner.distributor_id,
    -- akun tanpa region (mis. pusat) memakai region induk = National
    coalesce(v_owner.region_id, v_parent.region_id),
    0, 'approved', p_owner_id, now(),
    v_parent.skp_number || '-K' || lpad(v_seq::text, 2, '0'),
    p_parent_id, p_owner_id, v_seq
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_national_child_claim(uuid, uuid) is
  'Membuat klaim turunan SKP nasional untuk satu akun distributor; nomor urut per induk dialokasikan atomik. Hanya service_role. (075)';

revoke all on function public.create_national_child_claim(uuid, uuid) from public;
revoke all on function public.create_national_child_claim(uuid, uuid) from anon, authenticated;
grant execute on function public.create_national_child_claim(uuid, uuid) to service_role;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/075_national_child_claims.sql      -- harus "SEMUA LOLOS"
-- \i supabase/tests/074_national_campaign_access.sql   -- aturan induk tetap lolos
-- \i supabase/tests/067_distributor_campaign_access.sql -- aturan lama tetap lolos
--
-- select count(*) from public.campaigns where parent_campaign_id is not null;
-- -- diharapkan 0 sampai ada akun yang menekan "Buat Klaim".

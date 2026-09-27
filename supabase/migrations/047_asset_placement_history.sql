-- Monitoring POSM & Asset — Fase 6 (plans/plan-monitoring-posm-asset.md)
-- 1. Penanda catatan pendaftaran (is_registration) pada asset_placements
-- 2. create_marketing_asset menandai penempatan awal sebagai pendaftaran
-- 3. Guard: pendaftaran tidak bisa dihapus selama asset ada, perpindahan
--    tidak boleh bertanggal sebelum pendaftaran, asset terhapus tidak bisa
--    dipindahkan
-- 4. asset_current_status: pendaftaran kalah dari perpindahan di tanggal sama
-- 5. View asset_store_names untuk autocomplete nama toko

-- ============================================================
-- 1. PENANDA PENDAFTARAN
-- ============================================================
alter table public.asset_placements
  add column if not exists is_registration boolean not null default false;

-- Backfill: catatan pertama yang diinput per asset adalah pendaftaran
-- (dibuat create_marketing_asset bersama asset-nya).
update public.asset_placements p
   set is_registration = true
  from (
    select distinct on (asset_id) id
      from public.asset_placements
     order by asset_id, created_at, id
  ) first
 where p.id = first.id
   and not p.is_registration;

create unique index if not exists asset_placements_one_registration
  on public.asset_placements (asset_id)
  where is_registration;

-- ============================================================
-- 2. DAFTAR ASSET BARU + PENEMPATAN AWAL (pendaftaran)
-- ============================================================
create or replace function public.create_marketing_asset(
  p_code               text,
  p_name               text,
  p_asset_type         text,
  p_brand_id           uuid,
  p_serial_number      text,
  p_acquisition_date   date,
  p_acquisition_value  numeric,
  p_event_date         date,
  p_destination        text,
  p_region_id          uuid,
  p_distributor_id     uuid,
  p_store_name         text,
  p_store_address      text,
  p_pic_name           text,
  p_condition          text,
  p_notes              text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_asset_id uuid;
begin
  insert into public.marketing_assets (
    code, name, asset_type, brand_id, serial_number, acquisition_date, acquisition_value
  ) values (
    p_code, p_name, p_asset_type, p_brand_id, p_serial_number, p_acquisition_date, p_acquisition_value
  )
  returning id into v_asset_id;

  insert into public.asset_placements (
    asset_id, event_date, destination, region_id, distributor_id,
    store_name, store_address, pic_name, condition, notes, is_registration
  ) values (
    v_asset_id, p_event_date, p_destination, p_region_id, p_distributor_id,
    p_store_name, p_store_address, p_pic_name, p_condition, p_notes, true
  );

  return v_asset_id;
end;
$$;

-- ============================================================
-- 3. GUARD RIWAYAT PENEMPATAN
-- ============================================================
-- Menggantikan asset_placements_guard (migrasi 046) dan kini juga berjalan
-- saat insert.
create or replace function public.asset_placements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_active boolean;
  v_registration_date date;
begin
  select deleted_at is null into v_asset_active
    from public.marketing_assets where id = new.asset_id;

  if tg_op = 'INSERT' then
    if not coalesce(v_asset_active, false) then
      raise exception 'ASSET_TIDAK_DITEMUKAN: asset sudah dihapus atau tidak ada';
    end if;
  else
    if new.asset_id <> old.asset_id then
      raise exception 'Asset pada catatan penempatan tidak bisa diubah';
    end if;
    if new.is_registration <> old.is_registration then
      raise exception 'Penanda pendaftaran tidak bisa diubah';
    end if;

    if new.deleted_at is not null and old.deleted_at is null and coalesce(v_asset_active, false) then
      if new.is_registration then
        raise exception 'ASSET_PENDAFTARAN: catatan pendaftaran tidak bisa dihapus';
      end if;
      if not exists (
        select 1 from public.asset_placements
         where asset_id = new.asset_id and deleted_at is null and id <> new.id
      ) then
        raise exception 'ASSET_TANPA_LOKASI: catatan penempatan terakhir tidak bisa dihapus';
      end if;
    end if;
  end if;

  -- Urutan tanggal: pendaftaran selalu catatan paling awal.
  if new.deleted_at is null then
    if new.is_registration then
      if exists (
        select 1 from public.asset_placements
         where asset_id = new.asset_id and deleted_at is null and id <> new.id
           and event_date < new.event_date
      ) then
        raise exception 'ASSET_TANGGAL_PENDAFTARAN: tanggal pendaftaran melewati tanggal perpindahan';
      end if;
    else
      select event_date into v_registration_date
        from public.asset_placements
       where asset_id = new.asset_id and is_registration and deleted_at is null;
      if v_registration_date is not null and new.event_date < v_registration_date then
        raise exception 'ASSET_TANGGAL_SEBELUM_PENDAFTARAN: tanggal sebelum pendaftaran asset';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists asset_placements_guard on public.asset_placements;
create trigger asset_placements_guard
  before insert or update on public.asset_placements
  for each row execute function public.asset_placements_guard();

-- ============================================================
-- 4. STATUS TERKINI ASSET
-- ============================================================
-- Sama dengan migrasi 046, ditambah: di tanggal yang sama, perpindahan
-- selalu lebih baru daripada pendaftaran.
create or replace view public.asset_current_status
with (security_invoker = true)
as
select distinct on (a.id)
  a.id as asset_id,
  p.id as placement_id,
  p.event_date,
  p.destination,
  p.region_id,
  p.distributor_id,
  p.store_name,
  p.condition,
  (select count(*) from public.asset_placements pc where pc.asset_id = a.id)::integer as placement_count_all
from public.marketing_assets a
join public.asset_placements p on p.asset_id = a.id and p.deleted_at is null
where a.deleted_at is null
order by a.id, p.event_date desc, p.is_registration, p.created_at desc;

-- ============================================================
-- 5. AUTOCOMPLETE NAMA TOKO
-- ============================================================
-- Nama toko yang pernah diinput (tanpa membedakan huruf besar/kecil).
create or replace view public.asset_store_names
with (security_invoker = true)
as
select min(trim(store_name)) as store_name
from public.asset_placements
where deleted_at is null
  and length(trim(coalesce(store_name, ''))) > 0
group by lower(trim(store_name));

grant select on public.asset_store_names to authenticated;

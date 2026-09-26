-- Monitoring POSM & Asset — Fase 5 (plans/plan-monitoring-posm-asset.md)
-- 1. Tabel marketing_assets (register asset per unit, soft delete)
-- 2. Tabel asset_placements (riwayat lokasi & kondisi, soft delete)
-- 3. Aturan: asset selalu punya lokasi, hapus asset hanya jika baru didaftarkan
-- 4. Fungsi create_marketing_asset (asset + penempatan awal, satu transaksi)
-- 5. View asset_current_status (catatan penempatan terakhir per asset)
-- 6. RLS + trigger audit

-- ============================================================
-- 1. marketing_assets
-- ============================================================
-- Kondisi dan lokasi terkini TIDAK disimpan di sini, tetapi diturunkan dari
-- catatan asset_placements terakhir.
create table if not exists public.marketing_assets (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null check (length(trim(code)) > 0),
  name               text not null check (length(trim(name)) > 0),
  asset_type         text not null check (asset_type in (
                       'Cooler/Chiller', 'Rak Display', 'Gondola', 'Standing Banner', 'Tenda/Booth', 'Lainnya'
                     )),
  brand_id           uuid references public.brands(id),
  serial_number      text,
  acquisition_date   date not null,
  acquisition_value  numeric(15, 2) not null check (acquisition_value >= 0),
  photo_path         text,
  created_by         uuid references public.users(id) default auth.uid(),
  updated_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

-- Kode unik di antara asset yang belum dihapus (sama seperti posm_items).
create unique index if not exists marketing_assets_code_unique
  on public.marketing_assets (upper(code))
  where deleted_at is null;

create index if not exists idx_marketing_assets_brand_id on public.marketing_assets(brand_id);

create trigger marketing_assets_set_updated
  before update on public.marketing_assets
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 2. asset_placements
-- ============================================================
-- Ditempatkan wajib punya region dan nama toko; Gudang Pusat tidak menyimpan
-- data lokasi toko.
create table if not exists public.asset_placements (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references public.marketing_assets(id),
  event_date      date not null,
  destination     text not null check (destination in ('warehouse', 'placed')),
  region_id       uuid references public.regions(id),
  distributor_id  uuid references public.distributors(id),
  store_name      text,
  store_address   text,
  pic_name        text,
  condition       text not null check (condition in (
                    'Baik', 'Rusak Ringan', 'Rusak Berat', 'Hilang', 'Dihapusbukukan'
                  )),
  notes           text,
  photo_path      text,
  created_by      uuid references public.users(id) default auth.uid(),
  updated_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint asset_placements_placed_location check (
    destination <> 'placed'
    or (region_id is not null and length(trim(coalesce(store_name, ''))) > 0)
  ),
  constraint asset_placements_warehouse_location check (
    destination <> 'warehouse'
    or (region_id is null and distributor_id is null and store_name is null and store_address is null)
  )
);

create index if not exists idx_asset_placements_asset_date
  on public.asset_placements (asset_id, event_date);
create index if not exists idx_asset_placements_region_id
  on public.asset_placements (region_id);

create trigger asset_placements_set_updated
  before update on public.asset_placements
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 3. ATURAN INTEGRITAS
-- ============================================================
-- a) Asset tidak boleh ada tanpa lokasi: dicek di akhir transaksi (deferred),
--    sehingga insert asset harus disertai penempatan awal dalam transaksi
--    yang sama (lihat create_marketing_asset).
create or replace function public.marketing_assets_require_placement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null and not exists (
    select 1 from public.asset_placements
     where asset_id = new.id and deleted_at is null
  ) then
    raise exception 'ASSET_TANPA_LOKASI: asset wajib punya catatan penempatan';
  end if;
  return null;
end;
$$;

create constraint trigger marketing_assets_require_placement
  after insert on public.marketing_assets
  deferrable initially deferred
  for each row execute function public.marketing_assets_require_placement();

-- b) Catatan penempatan terakhir yang tersisa tidak bisa dihapus selama
--    asset masih ada, dan asset pada penempatan tidak bisa diganti.
create or replace function public.asset_placements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.asset_id <> old.asset_id then
    raise exception 'Asset pada catatan penempatan tidak bisa diubah';
  end if;

  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from public.marketing_assets where id = new.asset_id and deleted_at is null)
     and not exists (
       select 1 from public.asset_placements
        where asset_id = new.asset_id and deleted_at is null and id <> new.id
     ) then
    raise exception 'ASSET_TANPA_LOKASI: catatan penempatan terakhir tidak bisa dihapus';
  end if;
  return new;
end;
$$;

create trigger asset_placements_guard
  before update on public.asset_placements
  for each row execute function public.asset_placements_guard();

-- c) Asset hanya bisa dihapus selama baru punya catatan pendaftaran
--    (termasuk catatan yang sudah di-soft-delete). Asset dengan riwayat
--    perpindahan cukup diberi kondisi "Dihapusbukukan".
create or replace function public.marketing_assets_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and (select count(*) from public.asset_placements where asset_id = new.id) > 1 then
    raise exception 'ASSET_PUNYA_RIWAYAT: asset sudah punya riwayat penempatan';
  end if;
  return new;
end;
$$;

create trigger marketing_assets_guard_delete
  before update on public.marketing_assets
  for each row execute function public.marketing_assets_guard_delete();

-- ============================================================
-- 4. DAFTAR ASSET BARU + PENEMPATAN AWAL
-- ============================================================
-- SECURITY INVOKER: kedua insert tetap melewati RLS (can_manage_posm).
-- Satu panggilan RPC = satu transaksi, jadi asset tidak pernah tersimpan
-- tanpa penempatan awal.
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
    store_name, store_address, pic_name, condition, notes
  ) values (
    v_asset_id, p_event_date, p_destination, p_region_id, p_distributor_id,
    p_store_name, p_store_address, p_pic_name, p_condition, p_notes
  );

  return v_asset_id;
end;
$$;

revoke all on function public.create_marketing_asset(
  text, text, text, uuid, text, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) from public;
grant execute on function public.create_marketing_asset(
  text, text, text, uuid, text, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) to authenticated;

-- ============================================================
-- 5. STATUS TERKINI ASSET
-- ============================================================
-- Catatan penempatan terakhir (tanggal terbaru, lalu input terbaru) per
-- asset yang belum dihapus. placement_count_all ikut menghitung catatan
-- terhapus, untuk menentukan apakah asset masih boleh dihapus.
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
order by a.id, p.event_date desc, p.created_at desc;

grant select on public.asset_current_status to authenticated;

-- ============================================================
-- 6. RLS + AUDIT
-- ============================================================
create trigger marketing_assets_audit
  after insert or update on public.marketing_assets
  for each row execute function public.posm_audit_trigger();

create trigger asset_placements_audit
  after insert or update on public.asset_placements
  for each row execute function public.posm_audit_trigger();

alter table public.marketing_assets enable row level security;
alter table public.asset_placements enable row level security;

-- Baris yang di-soft-delete tetap lolos policy select (difilter di query).
create policy "marketing_assets_select_reader"
  on public.marketing_assets for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "marketing_assets_insert_writer"
  on public.marketing_assets for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "marketing_assets_update_writer"
  on public.marketing_assets for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

create policy "asset_placements_select_reader"
  on public.asset_placements for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "asset_placements_insert_writer"
  on public.asset_placements for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "asset_placements_update_writer"
  on public.asset_placements for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

-- Ringkasan Stok Asset — Fase 1 (plans/plan-asset-stok-ringkasan.md)
-- 1. Tabel asset_types (master jenis asset, soft delete) + seed 7 jenis
-- 2. marketing_assets.asset_type_id menggantikan kolom teks asset_type
-- 3. create_marketing_asset menerima p_asset_type_id
-- 4. RLS + trigger audit

-- ============================================================
-- 1. asset_types
-- ============================================================
create table if not exists public.asset_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  is_active   boolean not null default true,
  created_by  uuid references public.users(id) default auth.uid(),
  updated_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Nama unik tanpa membedakan huruf besar/kecil di antara yang belum dihapus.
create unique index if not exists asset_types_name_unique
  on public.asset_types (lower(trim(name)))
  where deleted_at is null;

create trigger asset_types_set_updated
  before update on public.asset_types
  for each row execute function public.posm_set_updated();

create trigger asset_types_audit
  after insert or update on public.asset_types
  for each row execute function public.posm_audit_trigger();

insert into public.asset_types (name)
select v.name
  from (values
    ('Cooler/Chiller'), ('Rak Display'), ('Gondola'), ('Standing Banner'),
    ('Tenda/Booth'), ('Lainnya'), ('Seragam/Pakaian')
  ) as v(name)
 where not exists (
   select 1 from public.asset_types t
    where lower(trim(t.name)) = lower(v.name) and t.deleted_at is null
 );

-- ============================================================
-- 2. marketing_assets.asset_type_id
-- ============================================================
alter table public.marketing_assets
  add column if not exists asset_type_id uuid references public.asset_types(id);

-- Isi dari teks lama, termasuk asset yang sudah di-soft-delete. Trigger
-- set_updated/audit/guard tidak perlu berjalan untuk backfill ini.
alter table public.marketing_assets disable trigger user;

update public.marketing_assets a
   set asset_type_id = t.id
  from public.asset_types t
 where lower(trim(t.name)) = lower(trim(a.asset_type))
   and t.deleted_at is null
   and a.asset_type_id is null;

alter table public.marketing_assets enable trigger user;

alter table public.marketing_assets alter column asset_type_id set not null;

create index if not exists idx_marketing_assets_asset_type_id
  on public.marketing_assets(asset_type_id);

-- ============================================================
-- 3. DAFTAR ASSET BARU + PENEMPATAN AWAL (dengan id jenis)
-- ============================================================
-- Fungsi lama (p_asset_type text) dihapus sebelum kolom teksnya.
drop function if exists public.create_marketing_asset(
  text, text, text, uuid, text, date, numeric, date, text, uuid, uuid, text, text, text, text, text
);

alter table public.marketing_assets drop column if exists asset_type;

create or replace function public.create_marketing_asset(
  p_code               text,
  p_name               text,
  p_asset_type_id      uuid,
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
    code, name, asset_type_id, brand_id, serial_number, acquisition_date, acquisition_value
  ) values (
    p_code, p_name, p_asset_type_id, p_brand_id, p_serial_number, p_acquisition_date, p_acquisition_value
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

revoke all on function public.create_marketing_asset(
  text, text, uuid, uuid, text, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) from public;
grant execute on function public.create_marketing_asset(
  text, text, uuid, uuid, text, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) to authenticated;

-- ============================================================
-- 4. RLS
-- ============================================================
alter table public.asset_types enable row level security;

-- Baris yang di-soft-delete tetap lolos policy select (difilter di query).
create policy "asset_types_select_reader"
  on public.asset_types for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "asset_types_insert_writer"
  on public.asset_types for insert
  to authenticated
  with check ((select public.can_manage_posm()));

-- Ubah nama, aktif/nonaktif, soft delete: admin/superadmin saja.
create policy "asset_types_update_admin"
  on public.asset_types for update
  to authenticated
  using (exists (
    select 1 from public.users
     where id = auth.uid() and is_active = true and role in ('admin', 'superadmin')
  ))
  with check (exists (
    select 1 from public.users
     where id = auth.uid() and is_active = true and role in ('admin', 'superadmin')
  ));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

-- Ringkasan Stok Asset — Fase 7 (plans/plan-asset-stok-ringkasan.md)
-- Pindahkan massal: catatan penempatan untuk banyak asset dibuat dalam satu
-- transaksi. Jika satu unit tidak lolos (sudah dihapus, Dihapusbukukan, atau
-- tanggal sebelum pendaftarannya), seluruh perpindahan ditolak dan pesan
-- error menyebut kode-kode unit tersebut.
-- p_condition null = tiap unit mempertahankan kondisi terakhirnya
-- (asset_current_status).
-- Security invoker: RLS marketing_assets/asset_placements (can_manage_posm)
-- tetap berlaku; trigger asset_placements_guard (migrasi 047) tetap jadi
-- penjaga akhir.

create or replace function public.move_marketing_assets_bulk(
  p_asset_ids       uuid[],
  p_event_date      date,
  p_destination     text,
  p_region_id       uuid,
  p_distributor_id  uuid,
  p_store_name      text,
  p_store_address   text,
  p_pic_name        text,
  p_condition       text,
  p_notes           text
)
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count        int := coalesce(array_length(p_asset_ids, 1), 0);
  v_found        int;
  v_codes        text;
  v_asset_id     uuid;
  v_condition    text;
  v_placement_id uuid;
  v_ids          uuid[] := '{}';
begin
  if v_count < 1 or v_count > 100 then
    raise exception 'PINDAH_JUMLAH_TIDAK_VALID: jumlah asset harus 1 sampai 100';
  end if;

  if (select count(distinct x) from unnest(p_asset_ids) x) <> v_count then
    raise exception 'PINDAH_ASSET_GANDA: daftar asset berisi asset yang sama';
  end if;

  select count(*) into v_found
  from public.marketing_assets a
  where a.id = any(p_asset_ids)
    and a.deleted_at is null;

  if v_found <> v_count then
    raise exception 'PINDAH_ASSET_TIDAK_DITEMUKAN: %', v_count - v_found;
  end if;

  select string_agg(a.code, ', ' order by a.code) into v_codes
  from public.marketing_assets a
  join public.asset_current_status s on s.asset_id = a.id
  where a.id = any(p_asset_ids)
    and s.condition = 'Dihapusbukukan';

  if v_codes is not null then
    raise exception 'PINDAH_DIHAPUSBUKUKAN: %', v_codes;
  end if;

  select string_agg(a.code, ', ' order by a.code) into v_codes
  from public.marketing_assets a
  join public.asset_placements p
    on p.asset_id = a.id and p.is_registration and p.deleted_at is null
  where a.id = any(p_asset_ids)
    and p_event_date < p.event_date;

  if v_codes is not null then
    raise exception 'PINDAH_TANGGAL_SEBELUM_PENDAFTARAN: %', v_codes;
  end if;

  foreach v_asset_id in array p_asset_ids loop
    select s.condition into v_condition
    from public.asset_current_status s
    where s.asset_id = v_asset_id;

    insert into public.asset_placements (
      asset_id, event_date, destination, region_id, distributor_id,
      store_name, store_address, pic_name, condition, notes
    ) values (
      v_asset_id, p_event_date, p_destination, p_region_id, p_distributor_id,
      p_store_name, p_store_address, p_pic_name, coalesce(p_condition, v_condition), p_notes
    )
    returning id into v_placement_id;

    v_ids := v_ids || v_placement_id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.move_marketing_assets_bulk(
  uuid[], date, text, uuid, uuid, text, text, text, text, text
) from public;
grant execute on function public.move_marketing_assets_bulk(
  uuid[], date, text, uuid, uuid, text, text, text, text, text
) to authenticated;

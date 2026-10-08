-- Ringkasan Stok Asset — Fase 6 (plans/plan-asset-stok-ringkasan.md)
-- Daftarkan N unit sekaligus: semua asset + penempatan awalnya dibuat dalam
-- satu transaksi. Jika ada kode yang sudah dipakai asset lain (yang belum
-- dihapus, sama dengan marketing_assets_code_unique), seluruh pendaftaran
-- ditolak dan pesan error menyebut kode-kode yang bentrok.
-- Security invoker: RLS marketing_assets/asset_placements (can_manage_posm)
-- tetap berlaku.

create or replace function public.create_marketing_assets_bulk(
  p_codes              text[],
  p_name               text,
  p_asset_type_id      uuid,
  p_brand_id           uuid,
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
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count    int := coalesce(array_length(p_codes, 1), 0);
  v_taken    text;
  v_code     text;
  v_asset_id uuid;
  v_ids      uuid[] := '{}';
begin
  if v_count < 1 or v_count > 100 then
    raise exception 'JUMLAH_UNIT_TIDAK_VALID: jumlah unit harus 1 sampai 100';
  end if;

  if (select count(distinct upper(c)) from unnest(p_codes) c) <> v_count then
    raise exception 'KODE_GANDA: daftar kode berisi kode yang sama';
  end if;

  select string_agg(a.code, ', ' order by a.code) into v_taken
  from public.marketing_assets a
  where a.deleted_at is null
    and upper(a.code) in (select upper(c) from unnest(p_codes) c);

  if v_taken is not null then
    raise exception 'KODE_BENTROK: %', v_taken;
  end if;

  foreach v_code in array p_codes loop
    insert into public.marketing_assets (
      code, name, asset_type_id, brand_id, serial_number, acquisition_date, acquisition_value
    ) values (
      v_code, p_name, p_asset_type_id, p_brand_id, null, p_acquisition_date, p_acquisition_value
    )
    returning id into v_asset_id;

    insert into public.asset_placements (
      asset_id, event_date, destination, region_id, distributor_id,
      store_name, store_address, pic_name, condition, notes, is_registration
    ) values (
      v_asset_id, p_event_date, p_destination, p_region_id, p_distributor_id,
      p_store_name, p_store_address, p_pic_name, p_condition, p_notes, true
    );

    v_ids := v_ids || v_asset_id;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.create_marketing_assets_bulk(
  text[], text, uuid, uuid, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) from public;
grant execute on function public.create_marketing_assets_bulk(
  text[], text, uuid, uuid, date, numeric, date, text, uuid, uuid, text, text, text, text, text
) to authenticated;

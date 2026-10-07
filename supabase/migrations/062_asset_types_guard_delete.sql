-- Ringkasan Stok Asset — Fase 4 (plans/plan-asset-stok-ringkasan.md)
-- Jenis asset hanya bisa dihapus (soft delete) jika belum pernah dipakai asset,
-- termasuk asset yang sudah di-soft-delete. Jenis yang sudah dipakai cukup
-- dinonaktifkan.

create or replace function public.asset_types_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from public.marketing_assets where asset_type_id = new.id) then
    raise exception 'JENIS_ASSET_DIPAKAI: jenis asset sudah dipakai asset';
  end if;
  return new;
end;
$$;

create trigger asset_types_guard_delete
  before update on public.asset_types
  for each row execute function public.asset_types_guard_delete();

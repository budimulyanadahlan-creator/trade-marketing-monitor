-- Monitoring POSM & Asset — Fase 1 (plans/plan-monitoring-posm-asset.md)
-- 1. Helper otorisasi can_manage_posm() / is_posm_reader()
-- 2. Tabel posm_items (master item POSM, soft delete)
-- 3. Tabel posm_audit_log + trigger audit generik (dipakai juga di fase 2 & 5)
-- 4. RLS: baca untuk semua non-distributor, tulis via can_manage_posm()

-- ============================================================
-- 1. HELPER OTORISASI
-- ============================================================
-- Hak tulis = departemen "Marketing" / "Trade Marketing" (tanpa membedakan
-- huruf besar/kecil, role apa pun kecuali distributor) atau admin/superadmin.
-- Harus sama dengan canManagePosm() di lib/posm.ts.
create or replace function public.can_manage_posm()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    left join public.departments d on d.id = u.department_id
    where u.id = auth.uid()
      and u.is_active = true
      and u.role <> 'distributor'
      and (
        u.role in ('admin', 'superadmin')
        or lower(trim(d.name)) in ('marketing', 'trade marketing')
      )
  );
$$;

-- Hak baca = semua user aktif kecuali distributor (tanpa region-lock).
create or replace function public.is_posm_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.is_active = true
      and u.role <> 'distributor'
  );
$$;

revoke all on function public.can_manage_posm() from public;
revoke all on function public.is_posm_reader() from public;
grant execute on function public.can_manage_posm() to authenticated;
grant execute on function public.is_posm_reader() to authenticated;

-- ============================================================
-- 2. posm_items
-- ============================================================
create table if not exists public.posm_items (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (length(trim(code)) > 0),
  name        text not null check (length(trim(name)) > 0),
  brand_id    uuid references public.brands(id),
  category    text not null check (category in (
                'Poster', 'Wobbler', 'Shelf Talker', 'Hanger', 'Banner', 'Sticker', 'Lainnya'
              )),
  unit        text not null check (unit in ('pcs', 'lembar', 'roll', 'set')),
  min_stock   integer check (min_stock is null or min_stock >= 0),
  photo_path  text,
  is_active   boolean not null default true,
  created_by  uuid references public.users(id) default auth.uid(),
  updated_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Kode unik di antara item yang belum dihapus, sehingga kode item yang
-- terhapus boleh dipakai ulang.
create unique index if not exists posm_items_code_unique
  on public.posm_items (upper(code))
  where deleted_at is null;

create index if not exists idx_posm_items_brand_id on public.posm_items(brand_id);

-- updated_at + updated_by otomatis (dipakai juga oleh tabel POSM/asset lain).
create or replace function public.posm_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger posm_items_set_updated
  before update on public.posm_items
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 3. AUDIT LOG
-- ============================================================
create table if not exists public.posm_audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid not null,
  action      text not null check (action in ('insert', 'update', 'soft_delete')),
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid references public.users(id),
  changed_at  timestamptz not null default now()
);

create index if not exists idx_posm_audit_log_record
  on public.posm_audit_log (table_name, record_id, changed_at);

-- Trigger generik: setiap tabel yang memakainya wajib punya kolom id dan
-- deleted_at. Hapus fisik tidak diizinkan (tidak ada policy delete), jadi
-- hanya INSERT dan UPDATE yang dicatat. SECURITY DEFINER agar bisa menulis
-- ke posm_audit_log yang tidak punya policy insert untuk authenticated.
create or replace function public.posm_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'insert';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'soft_delete';
  else
    v_action := 'update';
  end if;

  insert into public.posm_audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    new.id,
    v_action,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );

  return new;
end;
$$;

create trigger posm_items_audit
  after insert or update on public.posm_items
  for each row execute function public.posm_audit_trigger();

-- ============================================================
-- 4. RLS
-- ============================================================
alter table public.posm_items enable row level security;
alter table public.posm_audit_log enable row level security;

-- Baris yang di-soft-delete tetap lolos policy select (difilter di query),
-- supaya UPDATE deleted_at tidak ditolak dan audit bisa menelusurinya.
create policy "posm_items_select_reader"
  on public.posm_items for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "posm_items_insert_writer"
  on public.posm_items for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "posm_items_update_writer"
  on public.posm_items for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

-- Audit log hanya dibaca admin/superadmin; ditulis oleh trigger saja.
create policy "posm_audit_log_select_admin"
  on public.posm_audit_log for select
  to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin')
        and u.is_active = true
    )
  );

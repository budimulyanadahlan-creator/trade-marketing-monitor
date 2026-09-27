-- Monitoring Gimmick — Fase 1 (plans/plan-monitoring-gimmick.md)
-- Tabel gimmick_items (master item gimmick bernilai Rp, soft delete).
-- Baca DAN tulis hanya untuk can_manage_posm() (Marketing/Trade Marketing +
-- admin/superadmin). JANGAN pakai is_posm_reader() di jalur data gimmick.
-- Memakai ulang posm_set_updated() dan posm_audit_trigger() (migrasi 043).

create table if not exists public.gimmick_items (
  id               uuid primary key default gen_random_uuid(),
  code             text not null check (length(trim(code)) > 0),
  name             text not null check (length(trim(name)) > 0),
  brand_id         uuid references public.brands(id),
  category         text not null check (category in (
                     'Payung', 'Tas', 'Botol/Gelas', 'Mainan', 'Pakaian', 'Alat Tulis', 'Lainnya'
                   )),
  unit             text not null check (unit in ('pcs', 'set')),
  pcs_per_carton   integer check (pcs_per_carton is null or pcs_per_carton > 0),
  unit_cost        numeric(14, 2) not null check (unit_cost >= 0),
  suggested_price  numeric(14, 2) check (suggested_price is null or suggested_price >= 0),
  min_stock        integer check (min_stock is null or min_stock >= 0),
  program          text check (program is null or length(trim(program)) > 0),
  photo_path       text,
  is_active        boolean not null default true,
  created_by       uuid references public.users(id) default auth.uid(),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- Kode unik (tanpa membedakan huruf besar/kecil) di antara item yang belum
-- dihapus, sehingga kode item yang terhapus boleh dipakai ulang.
create unique index if not exists gimmick_items_code_unique
  on public.gimmick_items (upper(code))
  where deleted_at is null;

create index if not exists idx_gimmick_items_brand_id on public.gimmick_items(brand_id);

create trigger gimmick_items_set_updated
  before update on public.gimmick_items
  for each row execute function public.posm_set_updated();

create trigger gimmick_items_audit
  after insert or update on public.gimmick_items
  for each row execute function public.posm_audit_trigger();

-- ============================================================
-- RLS
-- ============================================================
alter table public.gimmick_items enable row level security;

-- Baris yang di-soft-delete tetap lolos policy select (difilter di query),
-- supaya UPDATE deleted_at tidak ditolak dan audit bisa menelusurinya.
create policy "gimmick_items_select_writer"
  on public.gimmick_items for select
  to authenticated
  using ((select public.can_manage_posm()));

create policy "gimmick_items_insert_writer"
  on public.gimmick_items for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "gimmick_items_update_writer"
  on public.gimmick_items for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

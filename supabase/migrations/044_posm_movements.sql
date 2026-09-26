-- Monitoring POSM & Asset — Fase 2 (plans/plan-monitoring-posm-asset.md)
-- 1. Tabel posm_movements (mutasi stok bertanda, soft delete)
-- 2. Validasi saldo berjalan (tidak boleh negatif di tanggal mana pun)
-- 3. Item yang punya mutasi tidak bisa dihapus
-- 4. View posm_stock_balances (saldo + tanggal mutasi terakhir per item)
-- 5. RLS + trigger audit

-- ============================================================
-- 1. posm_movements
-- ============================================================
-- quantity bertanda: positif untuk opening/in, negatif untuk out, dan
-- bertanda sesuai arah untuk adjustment. distributor_id & campaign_id baru
-- dipakai UI di fase 3.
create table if not exists public.posm_movements (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.posm_items(id),
  movement_date   date not null,
  type            text not null check (type in ('opening', 'in', 'out', 'adjustment')),
  quantity        integer not null check (quantity <> 0),
  region_id       uuid references public.regions(id),
  distributor_id  uuid references public.distributors(id),
  campaign_id     uuid references public.campaigns(id),
  notes           text,
  created_by      uuid references public.users(id) default auth.uid(),
  updated_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint posm_movements_sign check (
    (type in ('opening', 'in') and quantity > 0)
    or (type = 'out' and quantity < 0)
    or type = 'adjustment'
  ),
  constraint posm_movements_out_region check (type <> 'out' or region_id is not null),
  constraint posm_movements_adjustment_reason check (
    type <> 'adjustment' or length(trim(coalesce(notes, ''))) > 0
  )
);

create index if not exists idx_posm_movements_item_date
  on public.posm_movements (item_id, movement_date);
create index if not exists idx_posm_movements_region_id
  on public.posm_movements (region_id);

create trigger posm_movements_set_updated
  before update on public.posm_movements
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 2. VALIDASI SALDO BERJALAN
-- ============================================================
-- Harus sama dengan findBalanceViolation() di lib/posm.ts: saldo dihitung
-- per akhir hari dan tidak boleh negatif di tanggal mana pun, sehingga
-- Keluar bertanggal mundur sebelum stok Masuk ikut ditolak. Berlaku untuk
-- insert, edit, dan soft delete (baris dengan deleted_at tidak dihitung).
-- Baris item dikunci (FOR UPDATE) agar dua mutasi bersamaan untuk item yang
-- sama divalidasi berurutan. SECURITY DEFINER supaya melihat semua mutasi
-- item terlepas dari RLS.
create or replace function public.posm_validate_running_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item       record;
  v_violation  record;
begin
  if tg_op = 'UPDATE' and new.item_id <> old.item_id then
    raise exception 'Item pada mutasi tidak bisa diubah';
  end if;

  select id, is_active, deleted_at
    into v_item
    from public.posm_items
   where id = new.item_id
     for update;

  if tg_op = 'INSERT' and (v_item.id is null or v_item.deleted_at is not null or not v_item.is_active) then
    raise exception 'Item POSM tidak aktif atau sudah dihapus';
  end if;

  select mv_day, balance
    into v_violation
    from (
      select mv_day, sum(day_qty) over (order by mv_day) as balance
        from (
          select movement_date as mv_day, sum(quantity) as day_qty
            from (
              select movement_date, quantity
                from public.posm_movements
               where item_id = new.item_id
                 and deleted_at is null
                 and id <> new.id
              union all
              select new.movement_date, new.quantity
               where new.deleted_at is null
            ) all_moves
           group by movement_date
        ) per_day
    ) running
   where balance < 0
   order by mv_day
   limit 1;

  if found then
    raise exception 'POSM_SALDO_NEGATIF: saldo pada % menjadi %', v_violation.mv_day, v_violation.balance;
  end if;

  return new;
end;
$$;

create trigger posm_movements_validate_balance
  before insert or update on public.posm_movements
  for each row execute function public.posm_validate_running_balance();

-- ============================================================
-- 3. ITEM DENGAN MUTASI TIDAK BISA DIHAPUS
-- ============================================================
-- Termasuk mutasi yang sudah di-soft-delete, agar riwayat stok tidak hilang.
-- Item seperti itu hanya bisa dinonaktifkan.
create or replace function public.posm_items_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from public.posm_movements where item_id = new.id) then
    raise exception 'POSM_ITEM_PUNYA_MUTASI: item sudah punya mutasi stok';
  end if;
  return new;
end;
$$;

create trigger posm_items_guard_delete
  before update on public.posm_items
  for each row execute function public.posm_items_guard_delete();

-- ============================================================
-- 4. SALDO PER ITEM
-- ============================================================
-- Saldo = jumlah quantity mutasi yang belum dihapus (tidak disimpan).
-- movement_count_all ikut menghitung mutasi terhapus, untuk menentukan
-- apakah item masih boleh dihapus.
create or replace view public.posm_stock_balances
with (security_invoker = true)
as
select
  i.id as item_id,
  coalesce(sum(m.quantity) filter (where m.deleted_at is null), 0)::integer as balance,
  max(m.movement_date) filter (where m.deleted_at is null) as last_movement_date,
  count(m.id)::integer as movement_count_all
from public.posm_items i
left join public.posm_movements m on m.item_id = i.id
where i.deleted_at is null
group by i.id;

grant select on public.posm_stock_balances to authenticated;

-- ============================================================
-- 5. RLS + AUDIT
-- ============================================================
create trigger posm_movements_audit
  after insert or update on public.posm_movements
  for each row execute function public.posm_audit_trigger();

alter table public.posm_movements enable row level security;

create policy "posm_movements_select_reader"
  on public.posm_movements for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "posm_movements_insert_writer"
  on public.posm_movements for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "posm_movements_update_writer"
  on public.posm_movements for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

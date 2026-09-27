-- Monitoring Gimmick — Fase 2 (plans/plan-monitoring-gimmick.md)
-- 1. Tabel gimmick_movements (mutasi stok bertanda dalam pcs, soft delete)
-- 2. Snapshot harga pokok (diisi trigger, tidak bisa diisi klien)
-- 3. Validasi saldo berjalan (tidak boleh negatif di tanggal mana pun)
-- 4. Item gimmick yang punya mutasi tidak bisa dihapus
-- 5. View gimmick_stock_balances (saldo, tanggal terakhir, nilai stok)
-- 6. RLS + trigger audit
--
-- Baca DAN tulis hanya untuk can_manage_posm(). JANGAN pakai
-- is_posm_reader() di jalur data gimmick.

-- ============================================================
-- 1. gimmick_movements
-- ============================================================
-- quantity bertanda (pcs): positif untuk opening/in, negatif untuk out, dan
-- bertanda sesuai arah untuk adjustment. Kolom tujuan Keluar sudah dibuat
-- lengkap beserta aturannya; UI Keluar menyusul di fase 3.
create table if not exists public.gimmick_movements (
  id                  uuid primary key default gen_random_uuid(),
  item_id             uuid not null references public.gimmick_items(id),
  movement_date       date not null,
  type                text not null check (type in ('opening', 'in', 'out', 'adjustment')),
  quantity            integer not null check (quantity <> 0),
  unit_cost_snapshot  numeric(14, 2) not null check (unit_cost_snapshot >= 0),
  destination         text check (destination in ('region_distributor', 'event', 'internal', 'other')),
  region_id           uuid references public.regions(id),
  distributor_id      uuid references public.distributors(id),
  campaign_id         uuid references public.campaigns(id),
  recipient_name      text,
  photo_path          text,
  notes               text,
  created_by          uuid references public.users(id) default auth.uid(),
  updated_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint gimmick_movements_sign check (
    (type in ('opening', 'in') and quantity > 0)
    or (type = 'out' and quantity < 0)
    or type = 'adjustment'
  ),
  -- Tujuan wajib jika dan hanya jika Keluar.
  constraint gimmick_movements_out_destination check ((type = 'out') = (destination is not null)),
  constraint gimmick_movements_destination_region check (
    destination is distinct from 'region_distributor' or region_id is not null
  ),
  constraint gimmick_movements_notes_required check (
    (type <> 'adjustment' and destination is distinct from 'event'
       and destination is distinct from 'internal' and destination is distinct from 'other')
    or length(trim(coalesce(notes, ''))) > 0
  )
);

create index if not exists idx_gimmick_movements_item_date
  on public.gimmick_movements (item_id, movement_date);
create index if not exists idx_gimmick_movements_region_id
  on public.gimmick_movements (region_id);
create index if not exists idx_gimmick_movements_date
  on public.gimmick_movements (movement_date desc) where deleted_at is null;

create trigger gimmick_movements_set_updated
  before update on public.gimmick_movements
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 2. SNAPSHOT HARGA POKOK
-- ============================================================
-- Diambil dari harga master saat insert dan saat item diganti. Perubahan
-- lain (qty, tanggal, keterangan) mempertahankan snapshot lama, termasuk
-- jika klien mencoba mengirim nilai sendiri.
create or replace function public.gimmick_movements_snapshot_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.item_id <> old.item_id then
    select unit_cost into new.unit_cost_snapshot
      from public.gimmick_items
     where id = new.item_id;
  else
    new.unit_cost_snapshot := old.unit_cost_snapshot;
  end if;
  return new;
end;
$$;

create trigger gimmick_movements_snapshot_cost
  before insert or update on public.gimmick_movements
  for each row execute function public.gimmick_movements_snapshot_cost();

-- ============================================================
-- 3. VALIDASI SALDO BERJALAN
-- ============================================================
-- Logika sama dengan posm_validate_running_balance() (migrasi 044) dan
-- findBalanceViolation() di lib/posm.ts: saldo per akhir hari tidak boleh
-- negatif di tanggal mana pun. Berbeda dengan POSM, item pada mutasi boleh
-- diganti saat edit; saldo item lama (tanpa mutasi ini) dan item baru
-- (dengan mutasi ini) sama-sama divalidasi. Item dikunci berurutan menurut
-- id agar tidak deadlock.
create or replace function public.gimmick_balance_violation(p_item_id uuid, p_exclude_id uuid, p_date date, p_qty integer)
returns table (mv_day date, balance bigint)
language sql
stable
security definer
set search_path = public
as $$
  select mv_day, balance
    from (
      select mv_day, (sum(day_qty) over (order by mv_day))::bigint as balance
        from (
          select movement_date as mv_day, sum(quantity) as day_qty
            from (
              select movement_date, quantity
                from public.gimmick_movements
               where item_id = p_item_id
                 and deleted_at is null
                 and id <> p_exclude_id
              union all
              select p_date, p_qty
               where p_date is not null
            ) all_moves
           group by movement_date
        ) per_day
    ) running
   where balance < 0
   order by mv_day
   limit 1;
$$;

-- Hanya dipanggil trigger di bawah; SECURITY DEFINER melewati RLS, jadi
-- tidak boleh bisa dipanggil langsung lewat API.
revoke all on function public.gimmick_balance_violation(uuid, uuid, date, integer) from public, anon, authenticated;

create or replace function public.gimmick_validate_running_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_changed boolean := tg_op = 'UPDATE' and new.item_id <> old.item_id;
  v_item         record;
  v_violation    record;
begin
  perform 1
     from public.gimmick_items
    where id in (new.item_id, case when v_item_changed then old.item_id end)
    order by id
      for update;

  select id, is_active, deleted_at into v_item from public.gimmick_items where id = new.item_id;

  if (tg_op = 'INSERT' or v_item_changed)
     and (v_item.id is null or v_item.deleted_at is not null or not v_item.is_active) then
    raise exception 'Item gimmick tidak aktif atau sudah dihapus';
  end if;

  select * into v_violation
    from public.gimmick_balance_violation(
      new.item_id, new.id,
      case when new.deleted_at is null then new.movement_date end,
      new.quantity
    );
  if found then
    raise exception 'GIMMICK_SALDO_NEGATIF: saldo pada % menjadi %', v_violation.mv_day, v_violation.balance;
  end if;

  if v_item_changed then
    select * into v_violation
      from public.gimmick_balance_violation(old.item_id, new.id, null, 0);
    if found then
      raise exception 'GIMMICK_SALDO_NEGATIF: saldo item lama pada % menjadi %', v_violation.mv_day, v_violation.balance;
    end if;
  end if;

  return new;
end;
$$;

create trigger gimmick_movements_validate_balance
  before insert or update on public.gimmick_movements
  for each row execute function public.gimmick_validate_running_balance();

-- ============================================================
-- 4. ITEM DENGAN MUTASI TIDAK BISA DIHAPUS
-- ============================================================
-- Termasuk mutasi yang sudah di-soft-delete. Item seperti itu hanya bisa
-- dinonaktifkan.
create or replace function public.gimmick_items_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from public.gimmick_movements where item_id = new.id) then
    raise exception 'GIMMICK_ITEM_PUNYA_MUTASI: item sudah punya mutasi stok';
  end if;
  return new;
end;
$$;

create trigger gimmick_items_guard_delete
  before update on public.gimmick_items
  for each row execute function public.gimmick_items_guard_delete();

-- ============================================================
-- 5. SALDO & NILAI STOK PER ITEM
-- ============================================================
-- Nilai stok = saldo × harga pokok master terbaru (bukan snapshot).
-- security_invoker: RLS gimmick_items/gimmick_movements tetap berlaku,
-- sehingga non-penulis mendapat 0 baris.
create or replace view public.gimmick_stock_balances
with (security_invoker = true)
as
select
  i.id as item_id,
  coalesce(sum(m.quantity) filter (where m.deleted_at is null), 0)::integer as balance,
  max(m.movement_date) filter (where m.deleted_at is null) as last_movement_date,
  count(m.id)::integer as movement_count_all,
  (coalesce(sum(m.quantity) filter (where m.deleted_at is null), 0) * i.unit_cost)::numeric(18, 2) as stock_value
from public.gimmick_items i
left join public.gimmick_movements m on m.item_id = i.id
where i.deleted_at is null
group by i.id;

grant select on public.gimmick_stock_balances to authenticated;

-- ============================================================
-- 6. RLS + AUDIT
-- ============================================================
create trigger gimmick_movements_audit
  after insert or update on public.gimmick_movements
  for each row execute function public.posm_audit_trigger();

alter table public.gimmick_movements enable row level security;

create policy "gimmick_movements_select_writer"
  on public.gimmick_movements for select
  to authenticated
  using ((select public.can_manage_posm()));

create policy "gimmick_movements_insert_writer"
  on public.gimmick_movements for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "gimmick_movements_update_writer"
  on public.gimmick_movements for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update deleted_at).

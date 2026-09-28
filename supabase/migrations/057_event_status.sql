-- Monitoring Event & Activity — Fase 4 (plans/plan-monitoring-event.md)
-- 1. Validasi status di tabel events (alasan batal, realisasi Terlaksana)
-- 2. Terlaksana hanya untuk event yang sudah dimulai (tanggal WIB)
-- 3. Terlaksana wajib realisasi budget di event_costs (lintas tabel)
-- 4. Fungsi set_event_status (status + realisasi, satu transaksi)
-- Aturan yang sama dicek di form lewat parseEventStatusUpdate (lib/event.ts).
-- Perubahan status & realisasi tercatat oleh trigger audit migrasi 055.

-- ============================================================
-- 1. CHECK CONSTRAINT
-- ============================================================
-- Rencana tidak mewajibkan apa pun: field realisasi boleh tetap tersimpan
-- setelah koreksi Terlaksana → Rencana.
alter table public.events
  add constraint events_terlaksana_realization check (
    status <> 'terlaksana'
    or (actual_participants is not null and actual_sales is not null)
  ),
  add constraint events_batal_reason check (
    status <> 'batal'
    or length(trim(coalesce(cancel_reason, ''))) > 0
  );

-- ============================================================
-- 2. TERLAKSANA HANYA SETELAH DIMULAI
-- ============================================================
-- Dicek setiap kali event Terlaksana disimpan, termasuk saat tanggal mulai
-- diedit ke masa depan. Hari ini memakai tanggal WIB (todayInJakarta).
create or replace function public.events_check_started()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'terlaksana'
     and new.start_date > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'EVENT_BELUM_DIMULAI: event belum dimulai, belum bisa ditandai Terlaksana';
  end if;
  return new;
end;
$$;

create trigger events_check_started
  before insert or update on public.events
  for each row execute function public.events_check_started();

-- ============================================================
-- 3. REALISASI BUDGET WAJIB UNTUK TERLAKSANA
-- ============================================================
-- actual_budget ada di event_costs, jadi dicek di akhir transaksi (deferred)
-- dari kedua tabel: saat status events berubah dan saat event_costs diubah.
-- SECURITY DEFINER agar pengecekan tidak terpengaruh RLS pembaca.
create or replace function public.event_check_actual_budget(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.events e
      left join public.event_costs c on c.event_id = e.id
     where e.id = p_event_id
       and e.deleted_at is null
       and e.status = 'terlaksana'
       and c.actual_budget is null
  ) then
    raise exception 'EVENT_TANPA_REALISASI: event Terlaksana wajib punya realisasi budget';
  end if;
end;
$$;

revoke all on function public.event_check_actual_budget(uuid) from public;

create or replace function public.events_require_actual_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- IF terpisah: PL/pgSQL me-resolve semua field di satu ekspresi CASE,
  -- dan baris event_costs tidak punya kolom id.
  if tg_table_name = 'events' then
    perform public.event_check_actual_budget(new.id);
  else
    perform public.event_check_actual_budget(new.event_id);
  end if;
  return null;
end;
$$;

create constraint trigger events_require_actual_budget
  after insert or update on public.events
  deferrable initially deferred
  for each row execute function public.events_require_actual_budget();

create constraint trigger event_costs_require_actual_budget
  after update on public.event_costs
  deferrable initially deferred
  for each row execute function public.events_require_actual_budget();

-- ============================================================
-- 4. set_event_status
-- ============================================================
-- - Rencana: hanya status; realisasi dibiarkan tersimpan (koreksi).
-- - Terlaksana: peserta aktual, hasil sales, realisasi budget.
-- - Batal: alasan batal, realisasi budget opsional (biaya hangus).
-- SECURITY INVOKER: RLS update tetap berlaku, sehingga user tanpa
-- can_manage_posm() mendapat EVENT_TIDAK_DITEMUKAN seperti event terhapus.
create or replace function public.set_event_status(
  p_id                   uuid,
  p_status               text,
  p_actual_participants  integer,
  p_actual_sales         numeric,
  p_actual_budget        numeric,
  p_cancel_reason        text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_status not in ('rencana', 'terlaksana', 'batal') then
    raise exception 'STATUS_TIDAK_VALID: status tidak dikenal';
  end if;

  update public.events set
    status              = p_status,
    actual_participants = case when p_status = 'terlaksana' then p_actual_participants else actual_participants end,
    actual_sales        = case when p_status = 'terlaksana' then p_actual_sales else actual_sales end,
    cancel_reason       = case when p_status = 'batal' then p_cancel_reason else cancel_reason end
  where id = p_id
    and deleted_at is null;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: event tidak ditemukan atau sudah dihapus';
  end if;

  if p_status <> 'rencana' then
    update public.event_costs set actual_budget = p_actual_budget
     where event_id = p_id;

    if not found then
      raise exception 'EVENT_TIDAK_DITEMUKAN: biaya event tidak ditemukan';
    end if;
  end if;
end;
$$;

revoke all on function public.set_event_status(uuid, text, integer, numeric, numeric, text) from public;
grant execute on function public.set_event_status(uuid, text, integer, numeric, numeric, text) to authenticated;

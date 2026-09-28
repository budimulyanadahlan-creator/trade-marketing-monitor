-- Monitoring Event & Activity — Fase 1 (plans/plan-monitoring-event.md)
-- 1. Tabel events (fiscal_year/quarter diturunkan dari start_date)
-- 2. Tabel event_costs (1:1, biaya internal — tidak pernah untuk distributor)
-- 3. Aturan integritas: event aktif wajib punya baris biaya
-- 4. Fungsi create_event (event + biaya rencana, satu transaksi)
-- 5. RLS: baca semua non-distributor, tulis via can_manage_posm()

-- ============================================================
-- 1. events
-- ============================================================
create table if not exists public.events (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  -- Harus sama dengan EVENT_TYPES di lib/event.ts.
  event_type           text not null check (event_type in (
                         'Senam/Olahraga', 'Perayaan', 'Bazaar', 'Lomba/Run', 'Aktivitas Outlet MT',
                         'School to School', 'Launching Produk Baru', 'Local Region Event', 'Lainnya'
                       )),
  start_date           date not null,
  end_date             date not null,
  -- Kuartal fiskal (Q1 = Apr–Jun) dari tanggal mulai; event yang melewati
  -- batas kuartal dihitung di kuartal tanggal mulainya. Sama dengan
  -- eventFiscalPeriod() di lib/event.ts.
  fiscal_year          integer generated always as (
                         case when extract(month from start_date) >= 4
                              then extract(year from start_date)::integer
                              else extract(year from start_date)::integer - 1 end
                       ) stored,
  quarter              integer generated always as (
                         case when extract(month from start_date) >= 4
                              then ((extract(month from start_date)::integer - 4) / 3) + 1
                              else 4 end
                       ) stored,
  region_id            uuid not null references public.regions(id),
  location             text not null check (length(trim(location)) > 0),
  distributor_id       uuid references public.distributors(id),
  pic_name             text not null check (length(trim(pic_name)) > 0),
  target_participants  integer not null check (target_participants >= 0),
  target_sales         numeric(15, 2) not null check (target_sales >= 0),
  status               text not null default 'rencana' check (status in ('rencana', 'terlaksana', 'batal')),
  actual_participants  integer check (actual_participants is null or actual_participants >= 0),
  actual_sales         numeric(15, 2) check (actual_sales is null or actual_sales >= 0),
  cancel_reason        text,
  notes                text,
  created_by           uuid references public.users(id) default auth.uid(),
  updated_by           uuid references public.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  constraint events_dates check (end_date >= start_date)
);

create index if not exists idx_events_period
  on public.events (fiscal_year, quarter)
  where deleted_at is null;
create index if not exists idx_events_region_id on public.events (region_id);
create index if not exists idx_events_distributor_id on public.events (distributor_id);

create trigger events_set_updated
  before update on public.events
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 2. event_costs
-- ============================================================
-- Dipisah dari events agar RLS bisa menolak distributor sepenuhnya, sementara
-- events kelak (fase 7) boleh dibaca distributor sesuai region/distributor.
create table if not exists public.event_costs (
  event_id               uuid primary key references public.events(id),
  planned_budget         numeric(15, 2) not null check (planned_budget >= 0),
  actual_budget          numeric(15, 2) check (actual_budget is null or actual_budget >= 0),
  planned_sample_budget  numeric(15, 2) not null check (planned_sample_budget >= 0),
  vendor_id              uuid references public.vendors(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_event_costs_vendor_id on public.event_costs (vendor_id);

create or replace function public.event_costs_set_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger event_costs_set_updated
  before update on public.event_costs
  for each row execute function public.event_costs_set_updated();

-- ============================================================
-- 3. ATURAN INTEGRITAS
-- ============================================================
-- Rencana budget event & sample wajib: event aktif harus punya baris
-- event_costs. Dicek di akhir transaksi (deferred), sehingga insert event
-- harus disertai biayanya dalam transaksi yang sama (lihat create_event).
-- SECURITY DEFINER agar pengecekan tidak terpengaruh RLS pembaca.
create or replace function public.events_require_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null and not exists (
    select 1 from public.event_costs where event_id = new.id
  ) then
    raise exception 'EVENT_TANPA_BIAYA: event wajib punya rencana budget';
  end if;
  return null;
end;
$$;

create constraint trigger events_require_costs
  after insert on public.events
  deferrable initially deferred
  for each row execute function public.events_require_costs();

-- ============================================================
-- 4. create_event
-- ============================================================
-- SECURITY INVOKER: RLS insert tetap berlaku untuk kedua tabel.
create or replace function public.create_event(
  p_name                   text,
  p_event_type             text,
  p_start_date             date,
  p_end_date               date,
  p_region_id              uuid,
  p_location               text,
  p_pic_name               text,
  p_target_participants    integer,
  p_target_sales           numeric,
  p_planned_budget         numeric,
  p_planned_sample_budget  numeric
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.events (
    name, event_type, start_date, end_date, region_id, location, pic_name,
    target_participants, target_sales
  ) values (
    p_name, p_event_type, p_start_date, p_end_date, p_region_id, p_location, p_pic_name,
    p_target_participants, p_target_sales
  )
  returning id into v_event_id;

  insert into public.event_costs (event_id, planned_budget, planned_sample_budget)
  values (v_event_id, p_planned_budget, p_planned_sample_budget);

  return v_event_id;
end;
$$;

revoke all on function public.create_event(
  text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
) from public;
grant execute on function public.create_event(
  text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
) to authenticated;

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.events enable row level security;
alter table public.event_costs enable row level security;

-- is_posm_reader() = user aktif non-distributor, jadi distributor ditolak
-- penuh sampai fase 7. Baris yang di-soft-delete tetap lolos policy select
-- (difilter di query), supaya UPDATE deleted_at tidak ditolak.
create policy "events_select_reader"
  on public.events for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "events_insert_writer"
  on public.events for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "events_update_writer"
  on public.events for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Biaya: tidak pernah untuk distributor, termasuk setelah fase 7.
create policy "event_costs_select_internal"
  on public.event_costs for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "event_costs_insert_writer"
  on public.event_costs for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_costs_update_writer"
  on public.event_costs for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Tidak ada policy delete: hapus = soft delete (update events.deleted_at).

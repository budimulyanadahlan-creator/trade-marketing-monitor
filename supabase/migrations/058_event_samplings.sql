-- Monitoring Event & Activity — Fase 5 (plans/plan-monitoring-event.md)
-- 1. Tabel event_samplings (produk, qty, satuan — kelak boleh dibaca distributor)
-- 2. Tabel event_sampling_costs (nilai Rp per baris — tidak pernah untuk distributor)
-- 3. Aturan integritas: baris sampling aktif wajib punya nilai
-- 4. Audit ke posm_audit_log dengan record_id = event_id
-- 5. RLS (event_samplings seperti events, biaya internal saja)
-- 6. Fungsi save_event_sampling (baris + nilai, satu transaksi)
-- Aturan yang sama dicek di form lewat parseEventSampling (lib/event.ts).
-- Hapus baris = soft delete (update event_samplings.deleted_at).

-- ============================================================
-- 1. event_samplings
-- ============================================================
create table if not exists public.event_samplings (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id),
  product_name  text not null check (length(trim(product_name)) > 0),
  quantity      numeric(12, 2) not null check (quantity > 0),
  unit          text not null check (length(trim(unit)) > 0),
  sort_order    integer not null default 0,
  created_by    uuid references public.users(id) default auth.uid(),
  updated_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- Target FK komposit event_sampling_costs, agar event_id biaya selalu
  -- sama dengan event_id barisnya.
  constraint event_samplings_id_event unique (id, event_id)
);

create index if not exists idx_event_samplings_event_id
  on public.event_samplings (event_id, sort_order)
  where deleted_at is null;

-- posm_set_updated() juga mengisi updated_by.
create trigger event_samplings_set_updated
  before update on public.event_samplings
  for each row execute function public.posm_set_updated();

-- ============================================================
-- 2. event_sampling_costs
-- ============================================================
-- Dipisah dari event_samplings agar RLS bisa menolak distributor
-- sepenuhnya, seperti event_costs. event_id disimpan juga supaya audit
-- tercatat dengan record_id = event_id (event_costs_audit_trigger).
create table if not exists public.event_sampling_costs (
  sampling_id  uuid primary key,
  event_id     uuid not null,
  value        numeric(15, 2) not null check (value >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint event_sampling_costs_sampling_fkey
    foreign key (sampling_id, event_id) references public.event_samplings (id, event_id)
);

create index if not exists idx_event_sampling_costs_event_id on public.event_sampling_costs (event_id);

create trigger event_sampling_costs_set_updated
  before update on public.event_sampling_costs
  for each row execute function public.event_costs_set_updated();

-- ============================================================
-- 3. ATURAN INTEGRITAS
-- ============================================================
-- Nilai Rp wajib: baris sampling aktif harus punya baris biaya. Dicek di
-- akhir transaksi (deferred), seperti events_require_costs (migrasi 054).
create or replace function public.event_samplings_require_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null and not exists (
    select 1 from public.event_sampling_costs where sampling_id = new.id
  ) then
    raise exception 'SAMPLING_TANPA_NILAI: baris sampling wajib punya nilai Rp';
  end if;
  return null;
end;
$$;

create constraint trigger event_samplings_require_cost
  after insert on public.event_samplings
  deferrable initially deferred
  for each row execute function public.event_samplings_require_cost();

-- ============================================================
-- 4. AUDIT
-- ============================================================
-- Keduanya dicatat dengan record_id = event_id, sehingga riwayat satu event
-- mencakup rincian samplingnya.
create trigger event_samplings_audit
  after insert or update on public.event_samplings
  for each row execute function public.event_links_audit_trigger();

create trigger event_sampling_costs_audit
  after insert or update on public.event_sampling_costs
  for each row execute function public.event_costs_audit_trigger();

-- ============================================================
-- 5. RLS
-- ============================================================
alter table public.event_samplings enable row level security;
alter table public.event_sampling_costs enable row level security;

-- Sama dengan events: baca semua non-distributor (distributor menyusul di
-- fase 7), tulis via can_manage_posm(). Tidak ada policy delete.
create policy "event_samplings_select_reader"
  on public.event_samplings for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "event_samplings_insert_writer"
  on public.event_samplings for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_samplings_update_writer"
  on public.event_samplings for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- Nilai Rp: tidak pernah untuk distributor, termasuk setelah fase 7.
create policy "event_sampling_costs_select_internal"
  on public.event_sampling_costs for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "event_sampling_costs_insert_writer"
  on public.event_sampling_costs for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_sampling_costs_update_writer"
  on public.event_sampling_costs for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- ============================================================
-- 6. save_event_sampling
-- ============================================================
-- p_id null = baris baru (urutan terakhir), selain itu ubah baris aktif
-- milik event tersebut. Event terhapus ditolak.
-- SECURITY INVOKER: RLS tetap berlaku, sehingga user tanpa
-- can_manage_posm() gagal di insert atau mendapat SAMPLING_TIDAK_DITEMUKAN.
create or replace function public.save_event_sampling(
  p_event_id      uuid,
  p_id            uuid,
  p_product_name  text,
  p_quantity      numeric,
  p_unit          text,
  p_value         numeric
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := p_id;
begin
  if not exists (
    select 1 from public.events where id = p_event_id and deleted_at is null
  ) then
    raise exception 'EVENT_TIDAK_DITEMUKAN: event tidak ditemukan atau sudah dihapus';
  end if;

  if v_id is null then
    insert into public.event_samplings (event_id, product_name, quantity, unit, sort_order)
    values (
      p_event_id, p_product_name, p_quantity, p_unit,
      coalesce((
        select max(sort_order) + 1 from public.event_samplings
         where event_id = p_event_id and deleted_at is null
      ), 0)
    )
    returning id into v_id;

    insert into public.event_sampling_costs (sampling_id, event_id, value)
    values (v_id, p_event_id, p_value);
  else
    update public.event_samplings set
      product_name = p_product_name,
      quantity     = p_quantity,
      unit         = p_unit
    where id = v_id
      and event_id = p_event_id
      and deleted_at is null;

    if not found then
      raise exception 'SAMPLING_TIDAK_DITEMUKAN: baris sampling tidak ditemukan atau sudah dihapus';
    end if;

    update public.event_sampling_costs set value = p_value
     where sampling_id = v_id;

    if not found then
      raise exception 'SAMPLING_TIDAK_DITEMUKAN: nilai sampling tidak ditemukan';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_event_sampling(uuid, uuid, text, numeric, text, numeric) from public;
grant execute on function public.save_event_sampling(uuid, uuid, text, numeric, text, numeric) to authenticated;

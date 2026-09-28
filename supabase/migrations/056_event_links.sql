-- Monitoring Event & Activity — Fase 3 (plans/plan-monitoring-event.md)
-- 1. Tabel event_brands & event_campaigns (banyak-ke-banyak, soft delete)
-- 2. Audit tautan ke posm_audit_log dengan record_id = event_id
-- 3. RLS (sama dengan events)
-- 4. Pencarian SKP untuk form event (dengan region/distributor/brand SKP)
-- 5. create_event / update_event: distributor, vendor, keterangan, tautan

-- ============================================================
-- 1. TABEL TAUTAN
-- ============================================================
-- Melepas tautan = soft delete (deleted_at), agar tercatat di audit log.
-- Menautkan ulang membuat baris baru.
create table if not exists public.event_brands (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id),
  brand_id    uuid not null references public.brands(id),
  created_by  uuid references public.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create unique index if not exists uq_event_brands_active
  on public.event_brands (event_id, brand_id)
  where deleted_at is null;
create index if not exists idx_event_brands_brand_id
  on public.event_brands (brand_id)
  where deleted_at is null;

-- campaign_id menjadi null jika SKP dihapus permanen; nomor & nama SKP
-- disimpan sebagai snapshot saat ditautkan, sehingga tautan tetap tampil
-- apa adanya tanpa memblokir penghapusan SKP.
create table if not exists public.event_campaigns (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id),
  campaign_id    uuid references public.campaigns(id) on delete set null,
  skp_number     text,
  campaign_name  text,
  created_by     uuid references public.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create unique index if not exists uq_event_campaigns_active
  on public.event_campaigns (event_id, campaign_id)
  where deleted_at is null and campaign_id is not null;
create index if not exists idx_event_campaigns_campaign_id
  on public.event_campaigns (campaign_id);

-- SECURITY DEFINER: RLS campaigns membatasi user Marketing hanya melihat
-- SKP miliknya, padahal SKP mana pun boleh ditautkan.
create or replace function public.event_campaigns_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.skp_number, c.name
    into new.skp_number, new.campaign_name
    from public.campaigns c
   where c.id = new.campaign_id;

  if not found then
    raise exception 'SKP_TIDAK_DITEMUKAN: SKP tidak ditemukan';
  end if;

  return new;
end;
$$;

create trigger event_campaigns_snapshot
  before insert on public.event_campaigns
  for each row execute function public.event_campaigns_snapshot();

-- ============================================================
-- 2. AUDIT
-- ============================================================
-- Dicatat dengan record_id = event_id (seperti event_costs), sehingga
-- riwayat satu event mencakup tautannya.
create or replace function public.event_links_audit_trigger()
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
    new.event_id,
    v_action,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );

  return new;
end;
$$;

create trigger event_brands_audit
  after insert or update on public.event_brands
  for each row execute function public.event_links_audit_trigger();

create trigger event_campaigns_audit
  after insert or update on public.event_campaigns
  for each row execute function public.event_links_audit_trigger();

-- ============================================================
-- 3. RLS
-- ============================================================
-- Sama dengan events: baca semua non-distributor (distributor menyusul di
-- fase 7), tulis via can_manage_posm(). Tidak ada policy delete.
alter table public.event_brands enable row level security;
alter table public.event_campaigns enable row level security;

create policy "event_brands_select_reader"
  on public.event_brands for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "event_brands_insert_writer"
  on public.event_brands for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_brands_update_writer"
  on public.event_brands for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

create policy "event_campaigns_select_reader"
  on public.event_campaigns for select
  to authenticated
  using ((select public.is_posm_reader()));

create policy "event_campaigns_insert_writer"
  on public.event_campaigns for insert
  to authenticated
  with check ((select public.can_manage_posm()));

create policy "event_campaigns_update_writer"
  on public.event_campaigns for update
  to authenticated
  using ((select public.can_manage_posm()))
  with check ((select public.can_manage_posm()));

-- ============================================================
-- 4. PENCARIAN SKP (hanya penulis event)
-- ============================================================
-- Seperti search_posm_campaigns (migrasi 045), ditambah region/distributor/
-- brand SKP untuk saran isian form event.
create or replace function public.search_event_campaigns(p_query text)
returns table (
  id              uuid,
  skp_number      text,
  name            text,
  region_id       uuid,
  distributor_id  uuid,
  brand_id        uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name, c.region_id, c.distributor_id, c.brand_id
    from public.campaigns c
   where public.can_manage_posm()
     and c.status <> 'draft'
     and length(trim(coalesce(p_query, ''))) >= 2
     and (
       c.skp_number ilike '%' || trim(p_query) || '%'
       or c.aa_reference_number ilike '%' || trim(p_query) || '%'
       or c.name ilike '%' || trim(p_query) || '%'
     )
   order by c.created_at desc
   limit 20;
$$;

revoke all on function public.search_event_campaigns(text) from public;
grant execute on function public.search_event_campaigns(text) to authenticated;

-- Nomor & judul terkini SKP yang tertaut ke event (nomor SKP bisa terbit
-- setelah ditautkan), untuk semua pembaca event. Hanya campaign yang memang
-- tertaut, agar fungsi ini tidak bisa dipakai membaca SKP sembarang.
create or replace function public.event_campaign_refs(p_ids uuid[])
returns table (id uuid, skp_number text, name text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name, c.status::text
    from public.campaigns c
   where public.is_posm_reader()
     and c.id = any(p_ids)
     and exists (
       select 1 from public.event_campaigns ec
        where ec.campaign_id = c.id and ec.deleted_at is null
     );
$$;

revoke all on function public.event_campaign_refs(uuid[]) from public;
grant execute on function public.event_campaign_refs(uuid[]) to authenticated;

-- ============================================================
-- 5. create_event / update_event
-- ============================================================
-- Sinkronkan tautan aktif dengan daftar yang dikirim form: yang tidak ada
-- di daftar di-soft-delete, yang belum tertaut ditambahkan. Tautan ke SKP
-- yang sudah dihapus permanen (campaign_id null) dibiarkan.
-- SECURITY INVOKER: RLS tetap berlaku.
create or replace function public.sync_event_links(
  p_event_id      uuid,
  p_brand_ids     uuid[],
  p_campaign_ids  uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  p_brand_ids := coalesce(p_brand_ids, '{}');
  p_campaign_ids := coalesce(p_campaign_ids, '{}');

  update public.event_brands set deleted_at = now()
   where event_id = p_event_id
     and deleted_at is null
     and brand_id <> all(p_brand_ids);

  insert into public.event_brands (event_id, brand_id)
  select p_event_id, b
    from (select distinct unnest(p_brand_ids) as b) ids
   where not exists (
     select 1 from public.event_brands eb
      where eb.event_id = p_event_id and eb.brand_id = ids.b and eb.deleted_at is null
   );

  update public.event_campaigns set deleted_at = now()
   where event_id = p_event_id
     and deleted_at is null
     and campaign_id is not null
     and campaign_id <> all(p_campaign_ids);

  insert into public.event_campaigns (event_id, campaign_id)
  select p_event_id, c
    from (select distinct unnest(p_campaign_ids) as c) ids
   where not exists (
     select 1 from public.event_campaigns ec
      where ec.event_id = p_event_id and ec.campaign_id = ids.c and ec.deleted_at is null
   );
end;
$$;

revoke all on function public.sync_event_links(uuid, uuid[], uuid[]) from public;
grant execute on function public.sync_event_links(uuid, uuid[], uuid[]) to authenticated;

-- Parameter bertambah, jadi versi lama (migrasi 054/055) dihapus agar tidak
-- menjadi overload.
drop function if exists public.create_event(
  text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
);

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
  p_planned_sample_budget  numeric,
  p_distributor_id         uuid,
  p_vendor_id              uuid,
  p_notes                  text,
  p_brand_ids              uuid[],
  p_campaign_ids           uuid[]
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
    target_participants, target_sales, distributor_id, notes
  ) values (
    p_name, p_event_type, p_start_date, p_end_date, p_region_id, p_location, p_pic_name,
    p_target_participants, p_target_sales, p_distributor_id, p_notes
  )
  returning id into v_event_id;

  insert into public.event_costs (event_id, planned_budget, planned_sample_budget, vendor_id)
  values (v_event_id, p_planned_budget, p_planned_sample_budget, p_vendor_id);

  perform public.sync_event_links(v_event_id, p_brand_ids, p_campaign_ids);

  return v_event_id;
end;
$$;

revoke all on function public.create_event(
  text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric,
  uuid, uuid, text, uuid[], uuid[]
) from public;
grant execute on function public.create_event(
  text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric,
  uuid, uuid, text, uuid[], uuid[]
) to authenticated;

drop function if exists public.update_event(
  uuid, text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
);

create or replace function public.update_event(
  p_id                     uuid,
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
  p_planned_sample_budget  numeric,
  p_distributor_id         uuid,
  p_vendor_id              uuid,
  p_notes                  text,
  p_brand_ids              uuid[],
  p_campaign_ids           uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.events set
    name                = p_name,
    event_type          = p_event_type,
    start_date          = p_start_date,
    end_date            = p_end_date,
    region_id           = p_region_id,
    location            = p_location,
    pic_name            = p_pic_name,
    target_participants = p_target_participants,
    target_sales        = p_target_sales,
    distributor_id      = p_distributor_id,
    notes               = p_notes
  where id = p_id
    and deleted_at is null;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: event tidak ditemukan atau sudah dihapus';
  end if;

  update public.event_costs set
    planned_budget        = p_planned_budget,
    planned_sample_budget = p_planned_sample_budget,
    vendor_id             = p_vendor_id
  where event_id = p_id;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: biaya event tidak ditemukan';
  end if;

  perform public.sync_event_links(p_id, p_brand_ids, p_campaign_ids);
end;
$$;

revoke all on function public.update_event(
  uuid, text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric,
  uuid, uuid, text, uuid[], uuid[]
) from public;
grant execute on function public.update_event(
  uuid, text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric,
  uuid, uuid, text, uuid[], uuid[]
) to authenticated;

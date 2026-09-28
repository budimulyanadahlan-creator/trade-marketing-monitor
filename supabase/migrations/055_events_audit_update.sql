-- Monitoring Event & Activity — Fase 2 (plans/plan-monitoring-event.md)
-- 1. Audit log events & event_costs ke posm_audit_log (dibaca admin/superadmin)
-- 2. Fungsi update_event (event + biaya rencana, satu transaksi)
-- Hapus event = soft delete (update events.deleted_at) lewat policy update
-- yang sudah ada di migrasi 054, dan tercatat sebagai soft_delete.

-- ============================================================
-- 1. AUDIT
-- ============================================================
-- events punya kolom id dan deleted_at, jadi memakai trigger generik POSM.
create trigger events_audit
  after insert or update on public.events
  for each row execute function public.posm_audit_trigger();

-- event_costs tidak punya id/deleted_at (PK = event_id). Dicatat dengan
-- record_id = event_id agar riwayat satu event mencakup biayanya. Update
-- tanpa perubahan nilai tidak dicatat. SECURITY DEFINER agar bisa menulis ke
-- posm_audit_log yang tidak punya policy insert untuk authenticated.
create or replace function public.event_costs_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and
     (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then
    return new;
  end if;

  insert into public.posm_audit_log (table_name, record_id, action, old_data, new_data, changed_by)
  values (
    tg_table_name,
    new.event_id,
    case when tg_op = 'INSERT' then 'insert' else 'update' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new),
    auth.uid()
  );

  return new;
end;
$$;

create trigger event_costs_audit
  after insert or update on public.event_costs
  for each row execute function public.event_costs_audit_trigger();

-- ============================================================
-- 2. update_event
-- ============================================================
-- SECURITY INVOKER: RLS update tetap berlaku, sehingga user tanpa
-- can_manage_posm() tidak mengubah baris apa pun dan mendapat
-- EVENT_TIDAK_DITEMUKAN, sama seperti event yang sudah dihapus.
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
  p_planned_sample_budget  numeric
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
    target_sales        = p_target_sales
  where id = p_id
    and deleted_at is null;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: event tidak ditemukan atau sudah dihapus';
  end if;

  update public.event_costs set
    planned_budget        = p_planned_budget,
    planned_sample_budget = p_planned_sample_budget
  where event_id = p_id;

  if not found then
    raise exception 'EVENT_TIDAK_DITEMUKAN: biaya event tidak ditemukan';
  end if;
end;
$$;

revoke all on function public.update_event(
  uuid, text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
) from public;
grant execute on function public.update_event(
  uuid, text, text, date, date, uuid, text, text, integer, numeric, numeric, numeric
) to authenticated;

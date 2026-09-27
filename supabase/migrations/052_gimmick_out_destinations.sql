-- Monitoring Gimmick — Fase 3 (plans/plan-monitoring-gimmick.md)
-- Keluar dengan tujuan + SKP + daftar mutasi. Kolom dan check constraint
-- tujuan sudah dibuat di migrasi 051; migrasi ini menambah:
-- 1. Fungsi label SKP untuk mutasi gimmick (khusus can_manage_posm())
-- 2. Indeks untuk filter daftar mutasi
--
-- JANGAN pakai is_posm_reader() di jalur data gimmick.

-- ============================================================
-- 1. LABEL SKP MUTASI GIMMICK
-- ============================================================
-- posm_campaign_refs (migrasi 045) hanya untuk SKP yang ditautkan ke mutasi
-- POSM dan terbuka untuk semua pembaca POSM. Versi gimmick hanya untuk
-- pemegang can_manage_posm() dan hanya untuk SKP yang memang ditautkan ke
-- mutasi gimmick, agar tidak bisa dipakai membaca SKP sembarang (RLS
-- campaigns membatasi user Marketing hanya melihat SKP miliknya sendiri).
create or replace function public.gimmick_campaign_refs(p_ids uuid[])
returns table (id uuid, skp_number text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name
    from public.campaigns c
   where public.can_manage_posm()
     and c.id = any(p_ids)
     and exists (select 1 from public.gimmick_movements m where m.campaign_id = c.id);
$$;

revoke all on function public.gimmick_campaign_refs(uuid[]) from public, anon;
grant execute on function public.gimmick_campaign_refs(uuid[]) to authenticated;

-- ============================================================
-- 2. INDEKS DAFTAR MUTASI
-- ============================================================
create index if not exists idx_gimmick_movements_distributor_id
  on public.gimmick_movements (distributor_id);
create index if not exists idx_gimmick_movements_campaign_id
  on public.gimmick_movements (campaign_id);

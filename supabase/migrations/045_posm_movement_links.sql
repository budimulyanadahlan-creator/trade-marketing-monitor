-- Monitoring POSM & Asset — Fase 3 (plans/plan-monitoring-posm-asset.md)
-- 1. Pencarian SKP untuk mutasi Keluar
-- 2. Label SKP untuk mutasi yang tertaut
-- 3. Indeks untuk daftar mutasi lintas item
--
-- RLS campaigns membatasi siapa melihat SKP apa (mis. user Marketing hanya
-- SKP miliknya), padahal penulis POSM perlu menautkan SKP mana pun dan semua
-- pembaca perlu melihat nomor SKP yang tertaut. Kedua fungsi di bawah
-- SECURITY DEFINER dan hanya mengembalikan id, nomor SKP, dan nama.

-- ============================================================
-- 1. PENCARIAN SKP (hanya penulis POSM)
-- ============================================================
create or replace function public.search_posm_campaigns(p_query text)
returns table (id uuid, skp_number text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name
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

revoke all on function public.search_posm_campaigns(text) from public;
grant execute on function public.search_posm_campaigns(text) to authenticated;

-- ============================================================
-- 2. LABEL SKP MUTASI (semua pembaca POSM)
-- ============================================================
-- Hanya campaign yang memang ditautkan ke mutasi POSM, agar fungsi ini tidak
-- bisa dipakai membaca SKP sembarang.
create or replace function public.posm_campaign_refs(p_ids uuid[])
returns table (id uuid, skp_number text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name
    from public.campaigns c
   where public.is_posm_reader()
     and c.id = any(p_ids)
     and exists (select 1 from public.posm_movements m where m.campaign_id = c.id);
$$;

revoke all on function public.posm_campaign_refs(uuid[]) from public;
grant execute on function public.posm_campaign_refs(uuid[]) to authenticated;

-- ============================================================
-- 3. INDEKS DAFTAR MUTASI
-- ============================================================
create index if not exists idx_posm_movements_date
  on public.posm_movements (movement_date desc) where deleted_at is null;
create index if not exists idx_posm_movements_distributor_id
  on public.posm_movements (distributor_id);
create index if not exists idx_posm_movements_campaign_id
  on public.posm_movements (campaign_id);

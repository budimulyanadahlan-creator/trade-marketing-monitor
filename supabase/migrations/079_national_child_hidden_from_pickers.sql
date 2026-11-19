-- SKP Nasional — Fase 6 (plans/plan-skp-nasional.md)
-- Pemilih SKP di Monitoring POSM, Gimmick, dan Event tidak menampilkan klaim
-- turunan SKP nasional: yang ditautkan adalah SKP induknya. Tanpa ini tiap
-- klaim cabang ("<induk> – klaim <akun>", nomor -K01 dst.) ikut memenuhi
-- hasil pencarian.
--
-- Kedua fungsi didefinisikan ulang persis seperti migrasi 045 dan 056,
-- ditambah satu syarat `c.parent_campaign_id is null`. Tautan lama ke baris
-- turunan (bila ada) tetap terbaca lewat *_campaign_refs — fungsi itu tidak
-- diubah. Idempoten.

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
     and c.parent_campaign_id is null
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
     and c.parent_campaign_id is null
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

-- Monitoring Event & Activity — Fase 7 (plans/plan-monitoring-event.md)
-- 1. Helper region/distributor akun distributor yang sedang login
-- 2. RLS baca events untuk distributor: region sama ATAU distributor tertaut
-- 3. RLS baca event_brands, event_campaigns, event_samplings mengikuti events
-- 4. event_campaign_refs untuk semua pembaca event (termasuk distributor)
-- event_costs dan event_sampling_costs TIDAK diubah: policy select-nya tetap
-- is_posm_reader(), sehingga distributor tidak pernah bisa membaca biaya,
-- vendor, maupun nilai Rp sampling. Aturan yang sama dicek di aplikasi lewat
-- canViewEvent (lib/event.ts).

-- ============================================================
-- 1. HELPER
-- ============================================================
-- Null untuk user non-distributor/nonaktif, atau jika akun distributor tidak
-- punya region/distributor. Perbandingan dengan null bernilai null (tidak
-- lolos), sehingga distributor tanpa region hanya melihat event yang
-- menautkan distributornya. SECURITY DEFINER agar tidak bergantung RLS users.
create or replace function public.event_distributor_region_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.region_id
    from public.users u
   where u.id = auth.uid()
     and u.is_active = true
     and u.role = 'distributor';
$$;

create or replace function public.event_distributor_distributor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.distributor_id
    from public.users u
   where u.id = auth.uid()
     and u.is_active = true
     and u.role = 'distributor';
$$;

revoke all on function public.event_distributor_region_id() from public;
revoke all on function public.event_distributor_distributor_id() from public;
grant execute on function public.event_distributor_region_id() to authenticated;
grant execute on function public.event_distributor_distributor_id() to authenticated;

-- ============================================================
-- 2. events
-- ============================================================
-- Helper dibungkus (select ...) agar dievaluasi sekali per query, bukan per
-- baris (pola migrasi 042).
drop policy if exists "events_select_reader" on public.events;

create policy "events_select_reader"
  on public.events for select
  to authenticated
  using (
    (select public.is_posm_reader())
    or region_id = (select public.event_distributor_region_id())
    or distributor_id = (select public.event_distributor_distributor_id())
  );

-- ============================================================
-- 3. TABEL ANAK (brand, SKP, qty sampling)
-- ============================================================
-- Subquery ke events tunduk pada RLS events milik pembaca, sehingga baris
-- anak terlihat tepat jika event induknya terlihat.
drop policy if exists "event_brands_select_reader" on public.event_brands;

create policy "event_brands_select_reader"
  on public.event_brands for select
  to authenticated
  using (
    (select public.is_posm_reader())
    or exists (select 1 from public.events e where e.id = event_brands.event_id)
  );

drop policy if exists "event_campaigns_select_reader" on public.event_campaigns;

create policy "event_campaigns_select_reader"
  on public.event_campaigns for select
  to authenticated
  using (
    (select public.is_posm_reader())
    or exists (select 1 from public.events e where e.id = event_campaigns.event_id)
  );

drop policy if exists "event_samplings_select_reader" on public.event_samplings;

create policy "event_samplings_select_reader"
  on public.event_samplings for select
  to authenticated
  using (
    (select public.is_posm_reader())
    or exists (select 1 from public.events e where e.id = event_samplings.event_id)
  );

-- ============================================================
-- 4. event_campaign_refs
-- ============================================================
-- Nomor/judul/status terkini SKP tertaut, kini juga untuk distributor, tetapi
-- hanya SKP yang tertaut ke event yang boleh dilihat pembaca. distributor_id
-- dikembalikan agar aplikasi bisa menentukan apakah link SKP boleh dibuka
-- distributor (isDistributorAllowedOnCampaign). Tipe kembalian berubah,
-- jadi fungsi lama dihapus dulu.
drop function if exists public.event_campaign_refs(uuid[]);

create or replace function public.event_campaign_refs(p_ids uuid[])
returns table (id uuid, skp_number text, name text, status text, distributor_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.skp_number, c.name, c.status::text, c.distributor_id
    from public.campaigns c
   where c.id = any(p_ids)
     and exists (
       select 1
         from public.event_campaigns ec
         join public.events e on e.id = ec.event_id
        where ec.campaign_id = c.id
          and ec.deleted_at is null
          and e.deleted_at is null
          and (
            public.is_posm_reader()
            or e.region_id = public.event_distributor_region_id()
            or e.distributor_id = public.event_distributor_distributor_id()
          )
     );
$$;

revoke all on function public.event_campaign_refs(uuid[]) from public;
grant execute on function public.event_campaign_refs(uuid[]) to authenticated;

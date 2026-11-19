-- Tes SKP Nasional Fase 4 (migrasi 077). Jalankan di SQL editor Supabase
-- SETELAH migrasi 077. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Bagian A menguji fungsi akses per baris SKP untuk akun pusat terhadap klaim
-- turunan dengan skenario yang sama dengan
-- lib/distributor-campaign-guard.test.ts ("akun pusat dan klaim turunan").
-- Bagian B membuat klaim turunan atas nama akun pusat nyata di atas satu SKP
-- Disetujui nyata (dilewati dengan notice bila tidak ada SKP / akun yang
-- cocok).

begin;

-- ============================================================
-- A. Fungsi akses: akun pusat dan klaim turunan
-- ============================================================
do $$
declare
  v_sales  uuid := (select id from public.departments where lower(trim(name)) = 'sales' limit 1);
  v_edm    uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  v_mms    uuid := (select id from public.distributors where lower(name) = 'mitra monas sejahtera' limit 1);
  v_bir    uuid := (select id from public.distributors where lower(name) = 'bintang indo raya' limit 1);
  v_lain   uuid := gen_random_uuid();  -- perusahaan yang tidak berhubungan
  r_wcj    uuid := gen_random_uuid();
  r_ejb    uuid := gen_random_uuid();
  u_owner  uuid := gen_random_uuid();
  u_pusat  uuid := gen_random_uuid();
  u_lain   uuid := gen_random_uuid();

  pusat_edm   public.distributor_viewer := row(u_pusat, v_edm,  'pusat',  null);
  pusat_mms   public.distributor_viewer := row(u_pusat, v_mms,  'pusat',  null);
  pusat_lain  public.distributor_viewer := row(u_pusat, v_lain, 'pusat',  null);
  cabang_edm  public.distributor_viewer := row(u_lain,  v_edm,  'cabang', r_wcj);
  lama_edm    public.distributor_viewer := row(u_lain,  v_edm,  null,     r_wcj);
  cabang_mms  public.distributor_viewer := row(u_lain,  v_mms,  'cabang', r_wcj);
  owner_edm   public.distributor_viewer := row(u_owner, v_edm,  'cabang', r_wcj);
  nobody      public.distributor_viewer := null;

  t_edm public.campaigns;
  t_mms public.campaigns;
  t_bir public.campaigns;
  c     public.campaigns;
  s     text;
begin
  if v_sales is null or v_edm is null or v_mms is null or v_bir is null then
    raise exception 'GAGAL: master data (departemen Sales, distributor EDM, MMS, BIR) tidak ditemukan';
  end if;
  if (select parent_distributor_id from public.distributors where id = v_mms) is distinct from v_edm
     or (select parent_distributor_id from public.distributors where id = v_bir) is distinct from v_edm then
    raise exception 'GAGAL: MMS dan BIR harus anak perusahaan EDM';
  end if;

  t_edm := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'parent_campaign_id', gen_random_uuid(), 'claim_owner_id', u_owner,
    'child_seq', 1, 'distributor_id', v_edm, 'region_id', r_wcj,
    'department_id', v_sales, 'status', 'approved'));
  t_mms := jsonb_populate_record(t_edm, jsonb_build_object('distributor_id', v_mms));
  t_bir := jsonb_populate_record(t_edm, jsonb_build_object('distributor_id', v_bir));

  -- pusat perusahaan sama: hanya lihat, semua region
  if public.distributor_campaign_access(t_edm, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat harus view pada turunan cabang perusahaannya'; end if;
  c := jsonb_populate_record(t_edm, jsonb_build_object('region_id', r_ejb));
  if public.distributor_campaign_access(c, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat harus view pada turunan perusahaannya di region mana pun'; end if;

  -- pusat perusahaan induk: hanya lihat turunan anak perusahaan
  if public.distributor_campaign_access(t_mms, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat EDM harus view pada turunan MMS'; end if;
  if public.distributor_campaign_access(t_bir, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat EDM harus view pada turunan BIR'; end if;

  -- anak perusahaan tidak melihat turunan induk maupun anak lain
  if public.distributor_campaign_access(t_edm, pusat_mms) is not null then raise exception 'GAGAL: pusat MMS tidak boleh lihat turunan EDM'; end if;
  if public.distributor_campaign_access(t_bir, pusat_mms) is not null then raise exception 'GAGAL: pusat MMS tidak boleh lihat turunan BIR'; end if;
  if public.distributor_campaign_access(t_mms, pusat_mms) is distinct from 'view' then raise exception 'GAGAL: pusat MMS harus view pada turunan MMS'; end if;

  -- perusahaan yang tidak berhubungan
  if public.distributor_campaign_access(t_edm, pusat_lain) is not null then raise exception 'GAGAL: pusat perusahaan lain tidak boleh lihat turunan EDM'; end if;
  if public.distributor_campaign_access(t_mms, pusat_lain) is not null then raise exception 'GAGAL: pusat perusahaan lain tidak boleh lihat turunan MMS'; end if;

  -- cabang (termasuk scope lama / null) tidak pernah mendapat hak lihat ini
  if public.distributor_campaign_access(t_edm, cabang_edm) is not null then raise exception 'GAGAL: cabang seperusahaan seregion bukan pemilik tidak boleh lihat turunan'; end if;
  if public.distributor_campaign_access(t_edm, lama_edm)   is not null then raise exception 'GAGAL: akun scope lama diperlakukan sebagai cabang'; end if;
  if public.distributor_campaign_access(t_mms, cabang_edm) is not null then raise exception 'GAGAL: cabang perusahaan induk tidak boleh lihat turunan anak perusahaan'; end if;
  if public.distributor_campaign_access(t_edm, cabang_mms) is not null then raise exception 'GAGAL: cabang perusahaan lain tidak boleh lihat turunan'; end if;
  if public.distributor_campaign_access(t_edm, nobody)     is not null then raise exception 'GAGAL: non-distributor harus null pada turunan'; end if;

  -- pemilik tetap act; pusat yang menjadi pemilik juga act
  if public.distributor_campaign_access(t_edm, owner_edm) is distinct from 'act' then raise exception 'GAGAL: pemilik harus tetap act'; end if;
  c := jsonb_populate_record(t_edm, jsonb_build_object('claim_owner_id', u_pusat));
  if public.distributor_campaign_access(c, pusat_edm) is distinct from 'act' then raise exception 'GAGAL: pusat harus act pada turunannya sendiri'; end if;

  -- jendela status: pusat view di semua status terlihat termasuk Dibatalkan; draft tidak terlihat
  foreach s in array array['ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed', 'cancelled'] loop
    c := jsonb_populate_record(t_edm, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat harus view pada turunan berstatus %', s; end if;
    c := jsonb_populate_record(t_mms, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat induk harus view pada turunan anak berstatus %', s; end if;
  end loop;
  c := jsonb_populate_record(t_edm, jsonb_build_object('status', 'draft'));
  if public.distributor_campaign_access(c, pusat_edm) is not null then raise exception 'GAGAL: turunan berstatus draft tidak boleh terlihat pusat'; end if;
  c := jsonb_populate_record(t_edm, jsonb_build_object('status', 'cancelled'));
  if public.distributor_campaign_access(c, owner_edm) is distinct from 'view' then raise exception 'GAGAL: pemilik harus view pada turunannya yang dibatalkan'; end if;

  raise notice 'A LOLOS: akses akun pusat ke klaim turunan sesuai PRD';
end
$$;

-- ============================================================
-- B. Akun pusat membuat klaim turunannya sendiri
-- ============================================================
do $$
declare
  v_parent   uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  u_pusat    public.users;
  u_cabang   public.users;
  k          public.campaigns;
  v_k1       uuid;
  v_k2       uuid;
begin
  select c.id into v_parent
    from public.campaigns c
    join public.departments d on d.id = c.department_id
   where c.status = 'approved'
     and not c.is_national
     and c.parent_campaign_id is null
     and c.claim_amount is null
     and c.claim_submitted_by is null
     and lower(trim(d.name)) in ('sales', 'trade marketing')
     and not exists (select 1 from public.realizations z where z.campaign_id = c.id)
     and not exists (select 1 from public.distributor_receipts t where t.campaign_id = c.id)
     and not exists (select 1 from public.claim_events e where e.campaign_id = c.id)
     and not exists (select 1 from public.distributor_claim_checklists x where x.campaign_id = c.id)
     and not exists (select 1 from public.campaign_files f where f.campaign_id = c.id and f.document_type_id is not null)
   limit 1;

  -- akun pusat yang punya rekan cabang di perusahaan yang sama
  select p.* into u_pusat
    from public.users p
   where p.role = 'distributor' and p.is_active and p.distributor_id is not null
     and p.distributor_scope = 'pusat'
     and exists (
       select 1 from public.users b
        where b.role = 'distributor' and b.is_active
          and b.distributor_id = p.distributor_id
          and b.distributor_scope is distinct from 'pusat')
   order by p.region_id nulls first, p.id
   limit 1;
  select b.* into u_cabang
    from public.users b
   where b.role = 'distributor' and b.is_active
     and b.distributor_id = u_pusat.distributor_id
     and b.distributor_scope is distinct from 'pusat'
   order by b.id limit 1;

  if v_parent is null or v_national is null or u_pusat.id is null or u_cabang.id is null then
    raise notice 'B DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, atau pasangan akun pusat + cabang aktif seperusahaan untuk diuji';
    return;
  end if;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-077')
   where id = v_parent;

  -- B1. pusat membuat klaimnya sendiri: perusahaan akun, region akun atau National
  v_k1 := public.create_national_child_claim(v_parent, u_pusat.id);
  select * into k from public.campaigns where id = v_k1;
  if k.claim_owner_id <> u_pusat.id or k.distributor_id <> u_pusat.distributor_id then
    raise exception 'GAGAL: klaim akun pusat harus milik akun dan perusahaan itu';
  end if;
  if k.region_id <> coalesce(u_pusat.region_id, v_national) then
    raise exception 'GAGAL: klaim akun pusat tanpa region harus memakai region National';
  end if;
  if public.distributor_campaign_access_by_id(v_k1, row(u_pusat.id, u_pusat.distributor_id, u_pusat.distributor_scope, u_pusat.region_id)::public.distributor_viewer) is distinct from 'act' then
    raise exception 'GAGAL: pusat harus act pada klaimnya sendiri (by_id)';
  end if;
  if public.distributor_campaign_access_by_id(v_k1, row(u_cabang.id, u_cabang.distributor_id, u_cabang.distributor_scope, u_cabang.region_id)::public.distributor_viewer) is not null then
    raise exception 'GAGAL: cabang tidak boleh melihat klaim milik akun pusat (by_id)';
  end if;

  -- B2. pusat melihat klaim cabang perusahaannya, hanya lihat
  v_k2 := public.create_national_child_claim(v_parent, u_cabang.id);
  if public.distributor_campaign_access_by_id(v_k2, row(u_pusat.id, u_pusat.distributor_id, u_pusat.distributor_scope, u_pusat.region_id)::public.distributor_viewer) is distinct from 'view' then
    raise exception 'GAGAL: pusat harus view pada klaim cabang perusahaannya (by_id)';
  end if;

  -- B3. tetap view setelah klaim cabang itu dibatalkan
  perform public.cancel_national_child_claim(v_k2, u_cabang.id);
  if public.distributor_campaign_access_by_id(v_k2, row(u_pusat.id, u_pusat.distributor_id, u_pusat.distributor_scope, u_pusat.region_id)::public.distributor_viewer) is distinct from 'view' then
    raise exception 'GAGAL: pusat harus tetap view pada klaim cabang yang dibatalkan (by_id)';
  end if;

  raise notice 'B LOLOS: akun pusat membuat klaimnya sendiri dan memantau klaim cabang';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 4 (077)'; end $$;

rollback;

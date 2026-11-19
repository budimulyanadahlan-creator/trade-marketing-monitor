-- Tes SKP Nasional Fase 2 (migrasi 075). Jalankan di SQL editor Supabase
-- SETELAH migrasi 075. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Bagian A menguji fungsi akses per baris SKP untuk klaim turunan dengan
-- skenario yang sama dengan lib/distributor-campaign-guard.test.ts
-- ("klaim turunan SKP nasional"), agar aturan di database dan di aplikasi
-- terbukti sinkron.
-- Bagian B membuat klaim turunan sungguhan di atas satu SKP Disetujui nyata
-- (dilewati dengan notice bila tidak ada SKP / akun yang cocok).

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'campaigns' and column_name = 'parent_campaign_id'
  ) then
    raise exception 'GAGAL: migrasi 075_national_child_claims.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

-- ============================================================
-- A. Fungsi akses
-- ============================================================
do $$
declare
  v_sales  uuid := (select id from public.departments where lower(trim(name)) = 'sales' limit 1);
  v_edm    uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  v_mms    uuid := (select id from public.distributors where lower(name) = 'mitra monas sejahtera' limit 1);
  r_wcj    uuid := gen_random_uuid();
  r_ejb    uuid := gen_random_uuid();
  u_owner  uuid := gen_random_uuid();
  u_rekan  uuid := gen_random_uuid();

  owner_wcj    public.distributor_viewer := row(u_owner, v_edm, 'cabang', r_wcj);
  owner_ejb    public.distributor_viewer := row(u_owner, v_edm, 'cabang', r_ejb);
  owner_noreg  public.distributor_viewer := row(u_owner, v_edm, 'cabang', null);
  owner_orphan public.distributor_viewer := row(u_owner, null,  'cabang', r_wcj);
  rekan_wcj    public.distributor_viewer := row(u_rekan, v_edm, 'cabang', r_wcj);
  pusat_edm    public.distributor_viewer := row(u_rekan, v_edm, 'pusat',  null);
  cabang_mms   public.distributor_viewer := row(u_rekan, v_mms, 'cabang', r_wcj);
  nobody       public.distributor_viewer := null;

  turunan public.campaigns;
  biasa   public.campaigns;
  c       public.campaigns;
  s       text;
begin
  if v_sales is null or v_edm is null or v_mms is null then
    raise exception 'GAGAL: master data (departemen Sales, distributor EDM, MMS) tidak ditemukan';
  end if;

  turunan := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'parent_campaign_id', gen_random_uuid(), 'claim_owner_id', u_owner,
    'child_seq', 1, 'distributor_id', v_edm, 'region_id', r_wcj,
    'department_id', v_sales, 'status', 'approved'));
  biasa := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'distributor_id', v_edm, 'region_id', r_wcj,
    'department_id', v_sales, 'status', 'approved'));

  -- pemilik → act, apa pun region akunnya
  if public.distributor_campaign_access(turunan, owner_wcj)   is distinct from 'act' then raise exception 'GAGAL: pemilik harus act pada turunannya'; end if;
  if public.distributor_campaign_access(turunan, owner_ejb)   is distinct from 'act' then raise exception 'GAGAL: pemilik beda region harus tetap act'; end if;
  if public.distributor_campaign_access(turunan, owner_noreg) is distinct from 'act' then raise exception 'GAGAL: pemilik tanpa region harus tetap act'; end if;

  -- akun lain tidak melihat
  if public.distributor_campaign_access(turunan, rekan_wcj)  is not null then raise exception 'GAGAL: cabang seperusahaan seregion bukan pemilik tidak boleh lihat turunan'; end if;
  -- sejak migrasi 077 (Fase 4) pusat perusahaan turunan melihatnya, hanya lihat
  if public.distributor_campaign_access(turunan, pusat_edm) = 'act' then raise exception 'GAGAL: pusat tidak boleh bertindak atas turunan akun lain'; end if;
  if public.distributor_campaign_access(turunan, cabang_mms) is not null then raise exception 'GAGAL: perusahaan lain tidak boleh lihat turunan'; end if;
  if public.distributor_campaign_access(turunan, owner_orphan) is not null then raise exception 'GAGAL: pemilik tanpa perusahaan tidak boleh lihat turunan'; end if;
  if public.distributor_campaign_access(turunan, nobody)     is not null then raise exception 'GAGAL: non-distributor harus null pada turunan'; end if;

  -- jendela status ('cancelled' diuji di tes 076: sejak migrasi 076 turunan
  -- yang dibatalkan tetap terlihat pemiliknya, hanya lihat)
  foreach s in array array['draft'] loop
    c := jsonb_populate_record(turunan, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, owner_wcj) is not null then raise exception 'GAGAL: turunan berstatus % tidak boleh terlihat', s; end if;
  end loop;
  foreach s in array array['ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed'] loop
    c := jsonb_populate_record(turunan, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, owner_wcj) is distinct from 'act' then raise exception 'GAGAL: pemilik harus act pada turunan berstatus %', s; end if;
  end loop;

  -- baris biasa: aturan lama tidak berubah
  if public.distributor_campaign_access(biasa, rekan_wcj)  is distinct from 'act' then raise exception 'GAGAL: SKP biasa — cabang region sama harus act'; end if;
  if public.distributor_campaign_access(biasa, cabang_mms) is not null then raise exception 'GAGAL: SKP biasa — perusahaan lain tidak boleh lihat'; end if;

  raise notice 'A LOLOS: fungsi akses klaim turunan sesuai PRD';
end
$$;

-- ============================================================
-- B. Membuat klaim turunan di atas satu SKP Disetujui nyata
-- ============================================================
do $$
declare
  v_parent   uuid;
  v_number   text;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_admin    uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  u1         public.users;
  u2         public.users;
  k1         public.campaigns;
  k2         public.campaigns;
  p          public.campaigns;
  v_id       uuid;
  v_caught   boolean;
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
     and not exists (select 1 from public.distributor_claim_checklists k where k.campaign_id = c.id)
     and not exists (select 1 from public.campaign_files f where f.campaign_id = c.id and f.document_type_id is not null)
   limit 1;

  select * into u1 from public.users
   where role = 'distributor' and is_active and distributor_id is not null
   order by id limit 1;
  select * into u2 from public.users
   where role = 'distributor' and is_active and distributor_id is not null and id <> u1.id
   order by id limit 1;

  if v_parent is null or v_national is null or v_admin is null or u1.id is null or u2.id is null then
    raise notice 'B DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, admin, atau dua akun distributor aktif berperusahaan untuk diuji';
    return;
  end if;

  -- B1. SKP biasa bukan induk → ditolak
  v_caught := false;
  begin
    perform public.create_national_child_claim(v_parent, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim turunan atas SKP bukan nasional harus ditolak'; end if;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-075')
   where id = v_parent;
  select * into p from public.campaigns where id = v_parent;
  v_number := p.skp_number;

  -- B2. akun bukan distributor → ditolak
  v_caught := false;
  begin
    perform public.create_national_child_claim(v_parent, v_admin);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: admin tidak boleh menjadi pemilik klaim turunan'; end if;

  -- B3. dua akun → nomor urut 1 dan 2, isi diwarisi dari induk
  v_id := public.create_national_child_claim(v_parent, u1.id);
  select * into k1 from public.campaigns where id = v_id;
  v_id := public.create_national_child_claim(v_parent, u2.id);
  select * into k2 from public.campaigns where id = v_id;

  if k1.child_seq <> 1 or k2.child_seq <> 2 then raise exception 'GAGAL: nomor urut turunan harus 1 lalu 2 (dapat % dan %)', k1.child_seq, k2.child_seq; end if;
  if k1.skp_number <> v_number || '-K01' or k2.skp_number <> v_number || '-K02' then raise exception 'GAGAL: nomor turunan harus nomor induk + -K01 / -K02 (dapat % dan %)', k1.skp_number, k2.skp_number; end if;
  if k1.status <> 'approved' or k1.requested_budget <> 0 or k1.reference_number is not null then raise exception 'GAGAL: turunan harus Disetujui, bernilai 0, tanpa No surat'; end if;
  if k1.claim_owner_id <> u1.id or k1.distributor_id is distinct from u1.distributor_id then raise exception 'GAGAL: pemilik dan perusahaan turunan harus dari akun pembuat'; end if;
  if k1.region_id is distinct from coalesce(u1.region_id, v_national) then raise exception 'GAGAL: region turunan harus region akun (atau National bila akun tanpa region)'; end if;
  if k1.department_id is distinct from p.department_id
     or k1.brand_id is distinct from p.brand_id
     or k1.channel_id is distinct from p.channel_id
     or k1.promotion_category_id is distinct from p.promotion_category_id
     or k1.action_approval_id is distinct from p.action_approval_id
     or k1.start_date is distinct from p.start_date
     or k1.end_date is distinct from p.end_date
     or k1.objective is distinct from p.objective
     or k1.mechanism is distinct from p.mechanism then
    raise exception 'GAGAL: turunan harus mewarisi departemen, brand, channel, kategori, AA, periode, tujuan, dan mekanisme induk';
  end if;
  if position(p.name in k1.name) <> 1 then raise exception 'GAGAL: nama turunan harus diawali nama induk'; end if;

  -- B4. akun yang masih punya klaim belum diajukan → ditolak
  v_caught := false;
  begin
    perform public.create_national_child_claim(v_parent, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim kedua saat klaim pertama belum diajukan harus ditolak'; end if;

  -- B5. akses per ID: pemilik act, akun lain tidak melihat
  if public.distributor_campaign_access_by_id(k1.id, row(u1.id, u1.distributor_id, u1.distributor_scope, u1.region_id)::public.distributor_viewer) is distinct from 'act' then
    raise exception 'GAGAL: pemilik harus act pada turunannya (by_id)';
  end if;
  if public.distributor_campaign_access_by_id(k1.id, row(u2.id, u1.distributor_id, 'cabang', k1.region_id)::public.distributor_viewer) is not null then
    raise exception 'GAGAL: akun lain seperusahaan seregion tidak boleh melihat turunan (by_id)';
  end if;

  -- B6. bentuk baris turunan dijaga
  v_caught := false;
  begin
    update public.campaigns set requested_budget = 1000 where id = k1.id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: nilai SKP turunan harus tetap 0'; end if;

  v_caught := false;
  begin
    update public.campaigns set distributor_id = null where id = k1.id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: turunan harus punya perusahaan distributor'; end if;

  v_caught := false;
  begin
    update public.campaigns set parent_campaign_id = null, claim_owner_id = null, child_seq = null where id = k1.id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: penunjuk induk turunan tidak boleh diubah'; end if;

  -- B7. turunan tidak boleh punya turunan
  v_caught := false;
  begin
    perform public.create_national_child_claim(k1.id, u2.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: turunan tidak boleh punya turunan'; end if;

  -- B8. tanda nasional terkunci selama ada turunan; induk tidak bisa dihapus
  v_caught := false;
  begin
    update public.campaigns set is_national = false where id = v_parent;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: tanda nasional harus terkunci selama ada klaim turunan'; end if;

  v_caught := false;
  begin
    delete from public.campaigns where id = v_parent;
  exception when foreign_key_violation or restrict_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk yang punya turunan tidak boleh dihapus'; end if;

  -- B9. turunan menolak tanda terima, menerima realisasi dan masuk siklus klaim
  v_caught := false;
  begin
    insert into public.distributor_receipts (campaign_id, received_by) values (k1.id, u1.id);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: tanda terima pada klaim turunan harus ditolak'; end if;

  insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
  values (k1.id, 'TES-075', 1000, current_date, v_admin);
  update public.campaigns set status = 'ongoing' where id = k1.id;
  update public.campaigns
     set status = 'claim_submitted', claim_amount = 1000, claim_submitted_at = now(), claim_submitted_by = u1.id
   where id = k1.id;

  -- B10. setelah klaim pertama diajukan, akun boleh membuat klaim berikutnya
  v_id := public.create_national_child_claim(v_parent, u1.id);
  select * into k2 from public.campaigns where id = v_id;
  if k2.child_seq <> 3 or k2.skp_number <> v_number || '-K03' then raise exception 'GAGAL: klaim berikutnya harus bernomor urut 3 (dapat %)', k2.skp_number; end if;
  if k2.name not like '%(2)' then raise exception 'GAGAL: nama klaim kedua akun harus berakhiran (2) (dapat %)', k2.name; end if;

  raise notice 'B LOLOS: klaim turunan dibuat, dijaga, dan berjalan di alur klaim';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 2 (075)'; end $$;

rollback;

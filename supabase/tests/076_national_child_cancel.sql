-- Tes SKP Nasional Fase 3 (migrasi 076). Jalankan di SQL editor Supabase
-- SETELAH migrasi 076. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Bagian A menguji fungsi akses per baris SKP untuk klaim turunan yang
-- dibatalkan dengan skenario yang sama dengan
-- lib/distributor-campaign-guard.test.ts ("klaim turunan yang dibatalkan").
-- Bagian B membuat, membatalkan, dan mengulang klaim turunan di atas satu SKP
-- Disetujui nyata (dilewati dengan notice bila tidak ada SKP / akun yang
-- cocok), dengan skenario yang sama dengan cancelChildClaimError
-- (lib/national-skp.test.ts).

begin;

do $$
begin
  if to_regprocedure('public.cancel_national_child_claim(uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 076_national_child_cancel.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

-- ============================================================
-- A. Fungsi akses: turunan dibatalkan
-- ============================================================
do $$
declare
  v_sales  uuid := (select id from public.departments where lower(trim(name)) = 'sales' limit 1);
  v_edm    uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  v_mms    uuid := (select id from public.distributors where lower(name) = 'mitra monas sejahtera' limit 1);
  r_wcj    uuid := gen_random_uuid();
  u_owner  uuid := gen_random_uuid();
  u_rekan  uuid := gen_random_uuid();

  owner_wcj    public.distributor_viewer := row(u_owner, v_edm, 'cabang', r_wcj);
  owner_orphan public.distributor_viewer := row(u_owner, null,  'cabang', r_wcj);
  rekan_wcj    public.distributor_viewer := row(u_rekan, v_edm, 'cabang', r_wcj);
  pusat_edm    public.distributor_viewer := row(u_rekan, v_edm, 'pusat',  null);
  cabang_mms   public.distributor_viewer := row(u_rekan, v_mms, 'cabang', r_wcj);
  nobody       public.distributor_viewer := null;

  batal public.campaigns;
  c     public.campaigns;
  s     text;
begin
  if v_sales is null or v_edm is null or v_mms is null then
    raise exception 'GAGAL: master data (departemen Sales, distributor EDM, MMS) tidak ditemukan';
  end if;

  batal := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'parent_campaign_id', gen_random_uuid(), 'claim_owner_id', u_owner,
    'child_seq', 1, 'distributor_id', v_edm, 'region_id', r_wcj,
    'department_id', v_sales, 'status', 'cancelled'));

  -- pemilik tetap melihat, tanpa aksi
  if public.distributor_campaign_access(batal, owner_wcj) is distinct from 'view' then raise exception 'GAGAL: pemilik harus view pada turunannya yang dibatalkan'; end if;

  -- akun lain tetap tidak melihat
  if public.distributor_campaign_access(batal, rekan_wcj)    is not null then raise exception 'GAGAL: rekan seperusahaan tidak boleh lihat turunan dibatalkan'; end if;
  -- sejak migrasi 077 (Fase 4) pusat perusahaan turunan melihatnya, hanya lihat
  if public.distributor_campaign_access(batal, pusat_edm) = 'act' then raise exception 'GAGAL: pusat tidak boleh bertindak atas turunan akun lain yang dibatalkan'; end if;
  if public.distributor_campaign_access(batal, cabang_mms)   is not null then raise exception 'GAGAL: perusahaan lain tidak boleh lihat turunan dibatalkan'; end if;
  if public.distributor_campaign_access(batal, owner_orphan) is not null then raise exception 'GAGAL: pemilik tanpa perusahaan tidak boleh lihat turunan dibatalkan'; end if;
  if public.distributor_campaign_access(batal, nobody)       is not null then raise exception 'GAGAL: non-distributor harus null pada turunan dibatalkan'; end if;

  -- status lain: pemilik tetap act; draft tetap tidak terlihat
  foreach s in array array['approved', 'ongoing', 'claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed'] loop
    c := jsonb_populate_record(batal, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, owner_wcj) is distinct from 'act' then raise exception 'GAGAL: pemilik harus act pada turunan berstatus %', s; end if;
  end loop;
  c := jsonb_populate_record(batal, jsonb_build_object('status', 'draft'));
  if public.distributor_campaign_access(c, owner_wcj) is not null then raise exception 'GAGAL: turunan berstatus draft tidak boleh terlihat'; end if;

  -- SKP biasa dan induk nasional yang dibatalkan tetap tidak terlihat
  c := jsonb_populate_record(batal, jsonb_build_object('parent_campaign_id', null, 'claim_owner_id', null, 'child_seq', null));
  if public.distributor_campaign_access(c, rekan_wcj) is not null then raise exception 'GAGAL: SKP biasa yang dibatalkan tidak boleh terlihat'; end if;
  c := jsonb_populate_record(c, jsonb_build_object('is_national', true, 'distributor_id', null));
  if public.distributor_campaign_access(c, rekan_wcj) is not null then raise exception 'GAGAL: induk nasional yang dibatalkan tidak boleh terlihat'; end if;

  raise notice 'A LOLOS: akses klaim turunan yang dibatalkan sesuai PRD';
end
$$;

-- ============================================================
-- B. Klaim berulang dan pembatalan di atas satu SKP Disetujui nyata
-- ============================================================
do $$
declare
  v_parent   uuid;
  v_number   text;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_admin    uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_finance  uuid := (select id from public.users where role = 'finance' and is_active limit 1);
  u1         public.users;
  u2         public.users;
  k          public.campaigns;
  v_k1       uuid;
  v_k2       uuid;
  v_k3       uuid;
  v_k4       uuid;
  v_caught   boolean;
  v_events   integer;
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

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-076')
   where id = v_parent;
  select skp_number into v_number from public.campaigns where id = v_parent;

  v_k1 := public.create_national_child_claim(v_parent, u1.id);  -- -K01, milik u1
  v_k2 := public.create_national_child_claim(v_parent, u2.id);  -- -K02, milik u2

  -- B1. akun lain (bukan pemilik, bukan admin) tidak boleh membatalkan
  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_k1, u2.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: akun distributor lain tidak boleh membatalkan klaim turunan'; end if;

  if v_finance is not null then
    v_caught := false;
    begin
      perform public.cancel_national_child_claim(v_k1, v_finance);
    exception when raise_exception then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: Finance tidak boleh membatalkan klaim turunan'; end if;
  end if;

  -- B2. SKP induk / SKP biasa bukan klaim turunan
  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_parent, v_admin);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: SKP induk tidak boleh dibatalkan lewat fungsi klaim turunan'; end if;

  -- B3. pemilik membatalkan: status Dibatalkan, baris tetap ada, tercatat di riwayat
  perform public.cancel_national_child_claim(v_k1, u1.id);
  select * into k from public.campaigns where id = v_k1;
  if k.id is null or k.status <> 'cancelled' then raise exception 'GAGAL: klaim yang dibatalkan harus tetap ada berstatus Dibatalkan'; end if;
  if k.child_seq <> 1 or k.skp_number <> v_number || '-K01' then raise exception 'GAGAL: nomor klaim yang dibatalkan tidak boleh berubah'; end if;
  select count(*) into v_events from public.claim_events
   where campaign_id = v_k1 and action = 'child_cancelled' and actor_id = u1.id;
  if v_events <> 1 then raise exception 'GAGAL: pembatalan harus tercatat sekali di riwayat klaim (dapat %)', v_events; end if;

  -- B4. tidak bisa dibatalkan dua kali, tidak bisa diaktifkan kembali
  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_k1, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim yang sudah dibatalkan tidak boleh dibatalkan lagi'; end if;

  v_caught := false;
  begin
    update public.campaigns set status = 'approved' where id = v_k1;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim yang dibatalkan tidak boleh diaktifkan kembali'; end if;

  -- B5. klaim dibatalkan menolak realisasi
  v_caught := false;
  begin
    insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
    values (v_k1, 'TES-076', 1000, current_date, v_admin);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim yang dibatalkan harus menolak realisasi'; end if;

  -- B6. akses per ID: pemilik view, akun lain tidak melihat
  if public.distributor_campaign_access_by_id(v_k1, row(u1.id, u1.distributor_id, u1.distributor_scope, u1.region_id)::public.distributor_viewer) is distinct from 'view' then
    raise exception 'GAGAL: pemilik harus view pada turunannya yang dibatalkan (by_id)';
  end if;
  if public.distributor_campaign_access_by_id(v_k1, row(u2.id, u1.distributor_id, 'cabang', k.region_id)::public.distributor_viewer) is not null then
    raise exception 'GAGAL: akun lain tidak boleh melihat turunan yang dibatalkan (by_id)';
  end if;

  -- B7. setelah batal, akun boleh membuat klaim baru; nomor urut tidak dipakai ulang
  v_k3 := public.create_national_child_claim(v_parent, u1.id);
  select * into k from public.campaigns where id = v_k3;
  if k.child_seq <> 3 or k.skp_number <> v_number || '-K03' then raise exception 'GAGAL: nomor urut turunan yang dibatalkan tidak boleh dipakai ulang (dapat %)', k.skp_number; end if;

  -- B8. sudah ada realisasi → tidak bisa dibatalkan (pemilik maupun admin)
  insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
  values (v_k3, 'TES-076', 1000, current_date, v_admin);

  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_k3, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim yang sudah punya realisasi tidak boleh dibatalkan pemilik'; end if;

  v_caught := false;
  begin
    update public.campaigns set status = 'cancelled' where id = v_k3;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: UPDATE langsung ke Dibatalkan harus ditolak bila sudah ada realisasi'; end if;

  update public.campaigns set status = 'ongoing' where id = v_k3;
  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_k3, v_admin);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim Berjalan tidak boleh dibatalkan admin'; end if;

  -- B9. klaim Berjalan masih menghalangi klaim baru; setelah diajukan boleh
  v_caught := false;
  begin
    perform public.create_national_child_claim(v_parent, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim Berjalan harus menghalangi klaim baru akun itu'; end if;

  update public.campaigns
     set status = 'claim_submitted', claim_amount = 1000, claim_submitted_at = now(), claim_submitted_by = u1.id
   where id = v_k3;

  v_caught := false;
  begin
    perform public.cancel_national_child_claim(v_k3, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: klaim yang sudah diajukan tidak boleh dibatalkan'; end if;

  v_caught := false;
  begin
    update public.campaigns set status = 'cancelled' where id = v_k3;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: UPDATE langsung ke Dibatalkan harus ditolak bila sudah diajukan'; end if;

  v_k4 := public.create_national_child_claim(v_parent, u1.id);
  select * into k from public.campaigns where id = v_k4;
  if k.child_seq <> 4 or k.skp_number <> v_number || '-K04' then raise exception 'GAGAL: klaim berikutnya harus bernomor urut 4 (dapat %)', k.skp_number; end if;

  -- B10. admin membatalkan klaim turunan akun lain yang belum diajukan
  perform public.cancel_national_child_claim(v_k2, v_admin);
  select * into k from public.campaigns where id = v_k2;
  if k.status <> 'cancelled' then raise exception 'GAGAL: admin harus bisa membatalkan klaim turunan akun lain'; end if;
  select count(*) into v_events from public.claim_events
   where campaign_id = v_k2 and action = 'child_cancelled' and actor_id = v_admin;
  if v_events <> 1 then raise exception 'GAGAL: pembatalan oleh admin harus tercatat di riwayat klaim'; end if;

  -- B11. tanda nasional tetap terkunci walau semua turunannya dibatalkan
  perform public.cancel_national_child_claim(v_k4, u1.id);
  v_caught := false;
  begin
    update public.campaigns set is_national = false where id = v_parent;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: tanda nasional harus tetap terkunci selama ada klaim turunan (termasuk yang dibatalkan)'; end if;

  raise notice 'B LOLOS: klaim berulang dan pembatalan klaim turunan';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 3 (076)'; end $$;

rollback;

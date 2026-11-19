-- Tes SKP Nasional Fase 1 (migrasi 074). Jalankan di SQL editor Supabase
-- SETELAH migrasi 074. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Bagian A menguji fungsi akses per baris SKP dengan skenario yang sama
-- dengan lib/distributor-campaign-guard.test.ts ("SKP induk nasional"),
-- agar aturan di database dan di aplikasi terbukti sinkron.
-- Bagian B menguji constraint dan trigger pada satu SKP Disetujui nyata
-- (dilewati dengan notice bila tidak ada SKP yang cocok).

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'campaigns' and column_name = 'is_national'
  ) then
    raise exception 'GAGAL: migrasi 074_national_campaign_parent.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

-- ============================================================
-- A. Fungsi akses
-- ============================================================
do $$
declare
  v_sales    uuid := (select id from public.departments where lower(trim(name)) = 'sales' limit 1);
  v_tm       uuid := (select id from public.departments where lower(trim(name)) = 'trade marketing' limit 1);
  v_other    uuid := (select id from public.departments where lower(trim(name)) not in ('sales','trade marketing') limit 1);
  v_edm      uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  v_mms      uuid := (select id from public.distributors where lower(name) = 'mitra monas sejahtera' limit 1);
  v_bir      uuid := (select id from public.distributors where lower(name) = 'bintang indo raya' limit 1);
  r_wcj      uuid := gen_random_uuid();
  r_ejb      uuid := gen_random_uuid();
  r_nat      uuid := gen_random_uuid();
  u_id       uuid := gen_random_uuid();

  cabang_edm_wcj public.distributor_viewer := row(u_id, v_edm, 'cabang', r_wcj);
  cabang_edm_ejb public.distributor_viewer := row(u_id, v_edm, 'cabang', r_ejb);
  cabang_noreg   public.distributor_viewer := row(u_id, v_edm, 'cabang', null);
  legacy_noscope public.distributor_viewer := row(u_id, v_edm, null,     r_wcj);
  pusat_edm      public.distributor_viewer := row(u_id, v_edm, 'pusat',  r_nat);
  cabang_mms_wcj public.distributor_viewer := row(u_id, v_mms, 'cabang', r_wcj);
  pusat_mms      public.distributor_viewer := row(u_id, v_mms, 'pusat',  null);
  cabang_bir_ejb public.distributor_viewer := row(u_id, v_bir, 'cabang', r_ejb);
  orphan         public.distributor_viewer := row(u_id, null,  'cabang', r_wcj);
  nobody         public.distributor_viewer := null;

  nasional  public.campaigns;
  biasa     public.campaigns;
  tanpa_dis public.campaigns;
  c         public.campaigns;
  s         text;
begin
  if v_sales is null or v_tm is null or v_edm is null or v_mms is null or v_bir is null then
    raise exception 'GAGAL: master data (departemen Sales/TM, distributor EDM, MMS, BIR) tidak ditemukan';
  end if;

  nasional := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', true, 'distributor_id', null, 'region_id', r_nat,
    'department_id', v_sales, 'status', 'approved'));
  biasa := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'distributor_id', v_edm, 'region_id', r_wcj,
    'department_id', v_sales, 'status', 'approved'));
  tanpa_dis := jsonb_populate_record(null::public.campaigns, jsonb_build_object(
    'is_national', false, 'distributor_id', null, 'region_id', r_nat,
    'department_id', v_sales, 'status', 'approved'));

  -- induk nasional: semua akun berperusahaan → view, di semua region
  if public.distributor_campaign_access(nasional, cabang_edm_wcj) is distinct from 'view' then raise exception 'GAGAL: cabang EDM WCJ harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, cabang_edm_ejb) is distinct from 'view' then raise exception 'GAGAL: cabang EDM EJB harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, pusat_edm)      is distinct from 'view' then raise exception 'GAGAL: pusat EDM harus view (bukan act) induk nasional'; end if;
  if public.distributor_campaign_access(nasional, cabang_mms_wcj) is distinct from 'view' then raise exception 'GAGAL: cabang MMS harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, pusat_mms)      is distinct from 'view' then raise exception 'GAGAL: pusat MMS harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, cabang_bir_ejb) is distinct from 'view' then raise exception 'GAGAL: cabang BIR harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, cabang_noreg)   is distinct from 'view' then raise exception 'GAGAL: cabang tanpa region harus view induk nasional'; end if;
  if public.distributor_campaign_access(nasional, legacy_noscope) is distinct from 'view' then raise exception 'GAGAL: akun scope null harus view induk nasional'; end if;

  -- akun tanpa perusahaan / bukan distributor
  if public.distributor_campaign_access(nasional, orphan) is not null then raise exception 'GAGAL: akun tanpa perusahaan tidak boleh lihat induk nasional'; end if;
  if public.distributor_campaign_access(nasional, nobody) is not null then raise exception 'GAGAL: non-distributor harus null pada induk nasional'; end if;

  -- SKP tanpa distributor yang bukan nasional tetap tersembunyi
  if public.distributor_campaign_access(tanpa_dis, cabang_edm_wcj) is not null then raise exception 'GAGAL: SKP tanpa distributor bukan nasional tidak boleh terlihat cabang'; end if;
  if public.distributor_campaign_access(tanpa_dis, pusat_edm)      is not null then raise exception 'GAGAL: SKP tanpa distributor bukan nasional tidak boleh terlihat pusat'; end if;

  -- jendela status & departemen berlaku juga untuk induk nasional
  foreach s in array array['draft', 'submitted', 'rejected'] loop
    c := jsonb_populate_record(nasional, jsonb_build_object('status', s));
    if public.distributor_campaign_access(c, pusat_edm) is not null then raise exception 'GAGAL: induk nasional berstatus % tidak boleh terlihat', s; end if;
  end loop;
  c := jsonb_populate_record(nasional, jsonb_build_object('status', 'completed'));
  if public.distributor_campaign_access(c, cabang_mms_wcj) is distinct from 'view' then raise exception 'GAGAL: induk nasional Selesai harus tetap terlihat'; end if;
  c := jsonb_populate_record(nasional, jsonb_build_object('department_id', v_tm));
  if public.distributor_campaign_access(c, cabang_mms_wcj) is distinct from 'view' then raise exception 'GAGAL: induk nasional Trade Marketing harus terlihat'; end if;
  if v_other is not null then
    c := jsonb_populate_record(nasional, jsonb_build_object('department_id', v_other));
    if public.distributor_campaign_access(c, pusat_edm) is not null then raise exception 'GAGAL: induk nasional departemen non-Sales/TM tidak boleh terlihat'; end if;
  end if;

  -- baris biasa: aturan lama tidak berubah
  if public.distributor_campaign_access(biasa, cabang_edm_wcj) is distinct from 'act' then raise exception 'GAGAL: SKP biasa — cabang region sama harus act'; end if;
  if public.distributor_campaign_access(biasa, cabang_edm_ejb) is not null then raise exception 'GAGAL: SKP biasa — cabang region lain tidak boleh lihat'; end if;
  if public.distributor_campaign_access(biasa, pusat_edm)      is distinct from 'act' then raise exception 'GAGAL: SKP biasa — pusat harus act'; end if;
  if public.distributor_campaign_access(biasa, cabang_mms_wcj) is not null then raise exception 'GAGAL: SKP biasa — perusahaan lain tidak boleh lihat'; end if;

  raise notice 'A LOLOS: fungsi akses induk nasional sesuai PRD';
end
$$;

-- ============================================================
-- B. Constraint & trigger pada satu SKP Disetujui nyata
-- ============================================================
do $$
declare
  v_id       uuid;
  v_region   uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_other_r  uuid := (select id from public.regions where lower(trim(name)) <> 'national' limit 1);
  v_user     uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_doc      uuid := (select id from public.claim_document_types limit 1);
  v_edm      uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  r_wcj      uuid := gen_random_uuid();
  cabang     public.distributor_viewer;
  v_caught   boolean;
begin
  if v_national is null then
    raise exception 'GAGAL: region National tidak ada di master data — "Jadikan Nasional" tidak akan bisa dipakai';
  end if;

  select c.id, c.region_id into v_id, v_region
    from public.campaigns c
    join public.departments d on d.id = c.department_id
   where c.status = 'approved'
     and not c.is_national
     and c.distributor_id is not null
     and c.claim_amount is null
     and c.claim_submitted_by is null
     and lower(trim(d.name)) in ('sales', 'trade marketing')
     and not exists (select 1 from public.realizations z where z.campaign_id = c.id)
     and not exists (select 1 from public.distributor_receipts t where t.campaign_id = c.id)
     and not exists (select 1 from public.claim_events e where e.campaign_id = c.id)
     and not exists (select 1 from public.distributor_claim_checklists k where k.campaign_id = c.id)
     and not exists (select 1 from public.campaign_files f where f.campaign_id = c.id and f.document_type_id is not null)
   limit 1;

  if v_id is null or v_user is null or v_other_r is null then
    raise notice 'B DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim (atau admin / region lain) untuk diuji';
    return;
  end if;

  -- B1. nasional tetapi masih punya distributor → ditolak constraint
  v_caught := false;
  begin
    update public.campaigns set is_national = true, region_id = v_national where id = v_id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk nasional dengan distributor harus ditolak'; end if;

  -- B2. nasional tetapi region bukan National → ditolak trigger
  v_caught := false;
  begin
    update public.campaigns set is_national = true, distributor_id = null, region_id = v_other_r where id = v_id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk nasional di region selain National harus ditolak'; end if;

  -- B3. SKP yang sudah punya tanda terima tidak bisa dijadikan nasional
  insert into public.distributor_receipts (campaign_id, received_by) values (v_id, v_user);
  v_caught := false;
  begin
    update public.campaigns set is_national = true, distributor_id = null, region_id = v_national where id = v_id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: SKP bertanda terima harus ditolak dijadikan nasional'; end if;
  delete from public.distributor_receipts where campaign_id = v_id;

  -- B4. bentuk yang benar → berhasil
  update public.campaigns set is_national = true, distributor_id = null, region_id = v_national where id = v_id;

  -- B5. akses per ID (dipakai policy tabel anak) → view
  cabang := row(gen_random_uuid(), v_edm, 'cabang', r_wcj);
  if public.distributor_campaign_access_by_id(v_id, cabang) is distinct from 'view' then
    raise exception 'GAGAL: distributor_campaign_access_by_id harus view untuk induk nasional';
  end if;

  -- B6. induk menolak realisasi
  v_caught := false;
  begin
    insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
    values (v_id, 'TES-074', 1000, current_date, v_user);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: realisasi pada induk nasional harus ditolak'; end if;

  -- B7. induk menolak tanda terima
  v_caught := false;
  begin
    insert into public.distributor_receipts (campaign_id, received_by) values (v_id, v_user);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: tanda terima pada induk nasional harus ditolak'; end if;

  if v_doc is not null then
    -- B8. induk menolak checklist
    v_caught := false;
    begin
      insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
      values (v_id, v_user, v_doc, true);
    exception when check_violation then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: checklist pada induk nasional harus ditolak'; end if;

    -- B9. induk menolak dokumen klaim
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_id, 'tes.pdf', 'tes/074.pdf', 'application/pdf', 1, v_user, v_doc);
    exception when check_violation then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: dokumen klaim pada induk nasional harus ditolak'; end if;
  end if;

  -- B10. lampiran SKP biasa (tanpa jenis dokumen) tetap boleh
  insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by)
  values (v_id, 'lampiran.pdf', 'tes/074-lampiran.pdf', 'application/pdf', 1, v_user);

  -- B11. induk tidak bisa masuk siklus klaim
  v_caught := false;
  begin
    update public.campaigns set status = 'ongoing' where id = v_id;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk nasional tidak boleh berstatus Berjalan'; end if;

  -- B12. cabut tanda nasional → kembali SKP biasa tanpa distributor
  update public.campaigns set is_national = false where id = v_id;
  if public.distributor_campaign_access_by_id(v_id, cabang) is not null then
    raise exception 'GAGAL: setelah tanda nasional dicabut, SKP tanpa distributor harus tersembunyi';
  end if;

  raise notice 'B LOLOS: constraint dan trigger induk nasional bekerja';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 1 (074)'; end $$;

rollback;

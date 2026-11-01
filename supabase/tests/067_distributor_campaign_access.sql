-- Tes aturan fungsi akses distributor (migrasi 067). Jalankan di SQL editor
-- Supabase SETELAH migrasi 067. Tidak menulis data apa pun (transaksi
-- di-rollback); gagal = exception "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Fungsi distributor_campaign_access menerima konteks akun sebagai parameter,
-- sehingga tiap aturan bisa diuji tanpa login sebagai akun tersebut. Policy
-- RLS hanya membungkus fungsi ini (lihat 067), jadi lolosnya tes ini
-- menunjukkan aturan di RLS benar; verifikasi end-to-end tetap dilakukan
-- dengan login akun uji (acceptance criteria Fase 3).

begin;

-- Pengecekan awal: tipe & fungsi dibuat oleh migrasi 067. Tanpa ini, blok di
-- bawah gagal parse dengan pesan "type public.distributor_viewer does not exist".
do $$
begin
  if not exists (select 1 from pg_type where typname = 'distributor_viewer')
     or not exists (select 1 from pg_proc where proname = 'distributor_campaign_access') then
    raise exception 'GAGAL: migrasi 067_distributor_campaign_access.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_sales    uuid := (select id from public.departments where lower(trim(name)) = 'sales' limit 1);
  v_tm       uuid := (select id from public.departments where lower(trim(name)) = 'trade marketing' limit 1);
  v_other    uuid := (select id from public.departments where lower(trim(name)) not in ('sales','trade marketing') limit 1);
  v_edm      uuid := (select id from public.distributors where lower(name) = 'esham dima' limit 1);
  v_mms      uuid := (select id from public.distributors where lower(name) = 'mitra monas sejahtera' limit 1);
  v_bir      uuid := (select id from public.distributors where lower(name) = 'bintang indo raya' limit 1);
  v_ajs      uuid := (select id from public.distributors where parent_distributor_id is null and id <> coalesce((select id from public.distributors where lower(name) = 'esham dima' limit 1), gen_random_uuid()) limit 1);
  r_wcj      uuid := gen_random_uuid();
  r_ejb      uuid := gen_random_uuid();
  r_nat      uuid := gen_random_uuid();
  u_id       uuid := gen_random_uuid();

  cabang_edm_wcj public.distributor_viewer := row(u_id, v_edm, 'cabang', r_wcj);
  pusat_edm      public.distributor_viewer := row(u_id, v_edm, 'pusat',  r_nat);
  cabang_mms_wcj public.distributor_viewer := row(u_id, v_mms, 'cabang', r_wcj);
  pusat_mms      public.distributor_viewer := row(u_id, v_mms, 'pusat',  null);
  orphan         public.distributor_viewer := row(u_id, null,  'cabang', r_wcj);
  legacy_noscope public.distributor_viewer := row(u_id, v_edm, null,     r_wcj);
  nobody         public.distributor_viewer := null;
begin
  if v_sales is null or v_edm is null or v_mms is null or v_bir is null then
    raise exception 'GAGAL: master data (departemen Sales / distributor EDM, MMS, BIR) tidak ditemukan';
  end if;
  if (select parent_distributor_id from public.distributors where id = v_mms) is distinct from v_edm
     or (select parent_distributor_id from public.distributors where id = v_bir) is distinct from v_edm then
    raise exception 'GAGAL: MMS/BIR belum berinduk EDM (migrasi 065 belum jalan?)';
  end if;

  -- (a) perusahaan sama + pusat → act, semua region
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', pusat_edm) is distinct from 'act' then raise exception 'GAGAL: pusat EDM harus act di WCJ'; end if;
  if public.distributor_campaign_access(v_edm, r_ejb, v_tm,    'completed', pusat_edm) is distinct from 'act' then raise exception 'GAGAL: pusat EDM harus act di EJB'; end if;
  if public.distributor_campaign_access(v_edm, null,  v_sales, 'ongoing',  pusat_edm) is distinct from 'act' then raise exception 'GAGAL: pusat EDM harus act pada SKP tanpa region'; end if;

  -- (b) perusahaan sama + cabang → act hanya region sama
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', cabang_edm_wcj) is distinct from 'act' then raise exception 'GAGAL: cabang EDM WCJ harus act di WCJ'; end if;
  if public.distributor_campaign_access(v_edm, r_ejb, v_sales, 'approved', cabang_edm_wcj) is not null then raise exception 'GAGAL: cabang EDM WCJ tidak boleh lihat EJB'; end if;
  if public.distributor_campaign_access(v_edm, null,  v_sales, 'approved', cabang_edm_wcj) is not null then raise exception 'GAGAL: cabang tidak boleh lihat SKP tanpa region'; end if;
  if public.distributor_campaign_access(v_edm, r_ejb, v_sales, 'approved', legacy_noscope) is not null then raise exception 'GAGAL: scope null harus diperlakukan cabang'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', legacy_noscope) is distinct from 'act' then raise exception 'GAGAL: scope null di region sama harus act'; end if;

  -- (c) pusat induk → view saja; cabang induk → tidak
  if public.distributor_campaign_access(v_mms, r_wcj, v_sales, 'approved', pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat EDM harus view SKP MMS'; end if;
  if public.distributor_campaign_access(v_bir, r_ejb, v_sales, 'paid',     pusat_edm) is distinct from 'view' then raise exception 'GAGAL: pusat EDM harus view SKP BIR'; end if;
  if public.distributor_campaign_access(v_bir, r_wcj, v_sales, 'approved', cabang_edm_wcj) is not null then raise exception 'GAGAL: cabang EDM tidak boleh lihat SKP BIR'; end if;
  if public.distributor_campaign_access(v_mms, r_wcj, v_sales, 'approved', cabang_edm_wcj) is not null then raise exception 'GAGAL: cabang EDM tidak boleh lihat SKP MMS'; end if;

  -- anak tidak melihat induk maupun saudara
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', cabang_mms_wcj) is not null then raise exception 'GAGAL: MMS tidak boleh lihat EDM'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', pusat_mms) is not null then raise exception 'GAGAL: pusat MMS tidak boleh lihat EDM'; end if;
  if public.distributor_campaign_access(v_bir, r_wcj, v_sales, 'approved', cabang_mms_wcj) is not null then raise exception 'GAGAL: MMS tidak boleh lihat BIR'; end if;
  if public.distributor_campaign_access(v_bir, r_wcj, v_sales, 'approved', pusat_mms) is not null then raise exception 'GAGAL: pusat MMS tidak boleh lihat BIR'; end if;

  -- perusahaan tidak terkait
  if v_ajs is not null and public.distributor_campaign_access(v_ajs, r_nat, v_sales, 'approved', pusat_edm) is not null then raise exception 'GAGAL: pusat EDM tidak boleh lihat perusahaan non-anak'; end if;

  -- SKP tanpa perusahaan (sementara, sampai Fase 6)
  if public.distributor_campaign_access(null, r_wcj, v_sales, 'approved', cabang_edm_wcj) is distinct from 'act' then raise exception 'GAGAL: SKP tanpa distributor harus act bagi cabang region sama'; end if;
  if public.distributor_campaign_access(null, r_ejb, v_sales, 'approved', cabang_edm_wcj) is not null then raise exception 'GAGAL: SKP tanpa distributor region lain tidak boleh terlihat cabang'; end if;
  if public.distributor_campaign_access(null, r_ejb, v_sales, 'approved', pusat_edm) is distinct from 'act' then raise exception 'GAGAL: SKP tanpa distributor harus act bagi pusat'; end if;

  -- akun tanpa perusahaan / bukan distributor
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', orphan) is not null then raise exception 'GAGAL: akun tanpa perusahaan tidak boleh lihat'; end if;
  if public.distributor_campaign_access(null,  r_wcj, v_sales, 'approved', orphan) is not null then raise exception 'GAGAL: akun tanpa perusahaan tidak boleh lihat SKP tanpa distributor'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'approved', nobody) is not null then raise exception 'GAGAL: non-distributor harus null'; end if;

  -- status & departemen
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'draft',     pusat_edm) is not null then raise exception 'GAGAL: draft tidak boleh terlihat'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'submitted', pusat_edm) is not null then raise exception 'GAGAL: submitted tidak boleh terlihat'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, v_sales, 'rejected',  pusat_edm) is not null then raise exception 'GAGAL: rejected tidak boleh terlihat'; end if;
  if v_other is not null and public.distributor_campaign_access(v_edm, r_wcj, v_other, 'approved', pusat_edm) is not null then raise exception 'GAGAL: departemen non-Sales/TM tidak boleh terlihat'; end if;
  if public.distributor_campaign_access(v_edm, r_wcj, null, 'approved', pusat_edm) is not null then raise exception 'GAGAL: SKP tanpa departemen tidak boleh terlihat'; end if;

  raise notice 'SEMUA LOLOS: aturan distributor_campaign_access sesuai PRD';
end
$$;

rollback;

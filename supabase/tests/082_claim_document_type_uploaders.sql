-- Tes Pengunggah Khusus Dokumen Klaim Fase 1 (migrasi 082). Jalankan di SQL
-- editor Supabase SETELAH migrasi 082. Semua perubahan di-rollback; gagal =
-- exception "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Menguji: trigger "hanya distributor aktif bercakupan Pusat", pasangan unik,
-- dan RLS (baca semua terautentikasi, tulis hanya admin/superadmin). Bagian
-- RLS dilewati dengan notice bila sesi tidak bisa menyamar sebagai pengguna.

begin;

do $$
begin
  if to_regclass('public.claim_document_type_uploaders') is null then
    raise exception 'GAGAL: migrasi 082_claim_document_type_uploaders.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_doc     uuid := (select id from public.claim_document_types order by sort_order limit 1);
  v_admin   uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_pusat   uuid := (select id from public.users
                      where role = 'distributor' and is_active and distributor_id is not null
                        and distributor_scope = 'pusat' limit 1);
  v_cabang  uuid := (select id from public.users
                      where role = 'distributor' and is_active and distributor_scope = 'cabang' limit 1);
  v_finance uuid := (select id from public.users where role = 'finance' and is_active limit 1);
  v_caught  boolean;
  v_n       integer;
begin
  if v_doc is null or v_admin is null or v_pusat is null then
    raise notice 'DILEWATI: tidak ada jenis dokumen klaim, admin aktif, atau akun distributor Pusat aktif untuk diuji';
    return;
  end if;

  delete from public.claim_document_type_uploaders where document_type_id = v_doc;

  -- 1. akun Pusat aktif boleh ditunjuk
  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);

  -- 2. pasangan (jenis dokumen, akun) unik
  v_caught := false;
  begin
    insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
    values (v_doc, v_pusat, v_admin);
  exception when unique_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: penunjukan ganda untuk akun yang sama harus ditolak'; end if;

  -- 3. akun cabang, non-distributor, dan akun nonaktif ditolak trigger
  if v_cabang is not null then
    v_caught := false;
    begin
      insert into public.claim_document_type_uploaders (document_type_id, user_id) values (v_doc, v_cabang);
    exception when raise_exception then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: akun cabang tidak boleh ditunjuk'; end if;
  end if;

  v_caught := false;
  begin
    insert into public.claim_document_type_uploaders (document_type_id, user_id) values (v_doc, v_admin);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: akun non-distributor tidak boleh ditunjuk'; end if;

  delete from public.claim_document_type_uploaders where document_type_id = v_doc;
  update public.users set is_active = false where id = v_pusat;
  v_caught := false;
  begin
    insert into public.claim_document_type_uploaders (document_type_id, user_id) values (v_doc, v_pusat);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: akun nonaktif tidak boleh ditunjuk'; end if;
  update public.users set is_active = true where id = v_pusat;

  -- 4. menonaktifkan akun yang sudah ditunjuk tidak menghapus penunjukannya
  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);
  update public.users set is_active = false where id = v_pusat;
  select count(*) into v_n from public.claim_document_type_uploaders
   where document_type_id = v_doc and user_id = v_pusat;
  if v_n <> 1 then raise exception 'GAGAL: penunjukan harus tetap tercatat saat akunnya dinonaktifkan'; end if;
  update public.users set is_active = true where id = v_pusat;

  raise notice 'LOLOS: trigger dan pasangan unik';

  -- 5. RLS: non-admin bisa membaca, tidak bisa menulis
  perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_pusat::text, true);
  if (select auth.uid()) is distinct from v_pusat then
    raise notice 'DILEWATI: bagian RLS — tidak bisa menyamar sebagai pengguna di sesi ini (auth.uid() tidak mengikuti request.jwt.claims)';
    return;
  end if;

  set local role authenticated;

  select count(*) into v_n from public.claim_document_type_uploaders where document_type_id = v_doc;
  if v_n <> 1 then
    reset role;
    raise exception 'GAGAL: akun distributor harus bisa membaca penunjukan (terbaca %)', v_n;
  end if;

  delete from public.claim_document_type_uploaders where document_type_id = v_doc;
  get diagnostics v_n = row_count;
  if v_n <> 0 then
    reset role;
    raise exception 'GAGAL: akun distributor tidak boleh mencabut penunjukan';
  end if;

  v_caught := false;
  begin
    insert into public.claim_document_type_uploaders (document_type_id, user_id)
    select d.id, v_pusat from public.claim_document_types d where d.id <> v_doc limit 1;
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then
    reset role;
    raise exception 'GAGAL: akun distributor tidak boleh menunjuk pengunggah khusus';
  end if;

  if v_finance is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_finance, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_finance::text, true);
    v_caught := false;
    begin
      insert into public.claim_document_type_uploaders (document_type_id, user_id)
      select d.id, v_pusat from public.claim_document_types d where d.id <> v_doc limit 1;
    exception when insufficient_privilege then v_caught := true;
    end;
    if not v_caught then
      reset role;
      raise exception 'GAGAL: Finance tidak boleh menunjuk pengunggah khusus';
    end if;
  end if;

  -- 6. RLS: admin bisa mencabut dan menunjuk
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  delete from public.claim_document_type_uploaders where document_type_id = v_doc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    reset role;
    raise exception 'GAGAL: admin harus bisa mencabut penunjukan';
  end if;

  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);

  reset role;
  raise notice 'LOLOS: RLS baca semua, tulis hanya admin';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: Pengunggah Khusus Dokumen Klaim Fase 1 (082)'; end $$;

rollback;

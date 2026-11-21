-- Tes Pengunggah Khusus Dokumen Klaim Fase 2 (migrasi 083). Jalankan di SQL
-- editor Supabase SETELAH migrasi 083. Semua perubahan di-rollback; gagal =
-- exception "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Bagian A menguji fungsi "pengunggah khusus efektif" / "item terkunci" dengan
-- skenario yang sama dengan lib/claim-document-uploaders.test.ts
-- (effectiveSpecialUploaderIds). Bagian B menguji policy tambah file dan
-- checklist dengan menyamar sebagai akun nyata; dilewati dengan notice bila
-- sesi tidak bisa menyamar sebagai pengguna.
--
-- Data uji diambil dari data nyata: satu akun Pusat aktif, satu rekan
-- seperusahaan yang boleh bertindak, dan satu SKP Disetujui/Berjalan
-- perusahaan itu. Bila tidak ada, tes dilewati dengan notice.

begin;

do $$
begin
  if to_regprocedure('public.claim_document_is_locked(uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 083_claim_document_locked_items.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_doc    uuid := (select id from public.claim_document_types order by sort_order, id limit 1);
  v_doc2   uuid := (select id from public.claim_document_types order by sort_order, id offset 1 limit 1);
  v_admin  uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_pusat  uuid;   -- akun Pusat yang akan ditunjuk
  v_comp   uuid;   -- perusahaan akun itu
  v_rekan  uuid;   -- rekan seperusahaan yang boleh bertindak atas v_c1, bukan pengunggah khusus
  v_c1     uuid;   -- SKP perusahaan sendiri, Disetujui/Berjalan
  v_c2     uuid;   -- SKP anak perusahaan (opsional)
  v_c3     uuid;   -- SKP perusahaan yang tidak berhubungan (opsional)
  v_file   uuid;
  v_caught boolean;
  v_n      integer;
begin
  -- Akun Pusat + SKP perusahaannya + rekan yang boleh bertindak di SKP itu.
  select u.id, u.distributor_id, c.id
    into v_pusat, v_comp, v_c1
    from public.users u
    join public.campaigns c on c.distributor_id = u.distributor_id
    join public.departments d on d.id = c.department_id
   where u.role = 'distributor' and u.is_active and u.distributor_scope = 'pusat'
     and c.status in ('approved', 'ongoing')
     and not c.is_national
     and c.parent_campaign_id is null
     and lower(trim(d.name)) in ('sales', 'trade marketing')
     and exists (
       select 1 from public.users r
        where r.role = 'distributor' and r.is_active
          and r.distributor_id = u.distributor_id
          and r.id <> u.id
          and (r.distributor_scope = 'pusat' or r.region_id = c.region_id)
     )
   order by c.created_at desc
   limit 1;

  if v_doc is null or v_doc2 is null or v_admin is null or v_pusat is null then
    raise notice 'DILEWATI: butuh 2 jenis dokumen klaim, admin aktif, dan akun Pusat aktif yang punya rekan seperusahaan serta SKP Sales/TM Disetujui/Berjalan';
    return;
  end if;

  select r.id into v_rekan
    from public.users r
    join public.campaigns c on c.id = v_c1
   where r.role = 'distributor' and r.is_active
     and r.distributor_id = v_comp
     and r.id <> v_pusat
     and (r.distributor_scope = 'pusat' or r.region_id = c.region_id)
   order by (r.distributor_scope = 'pusat'), r.id
   limit 1;

  select c.id into v_c2
    from public.campaigns c
    join public.distributors d on d.id = c.distributor_id
   where d.parent_distributor_id = v_comp
   limit 1;

  select c.id into v_c3
    from public.campaigns c
    join public.distributors d on d.id = c.distributor_id
   where c.distributor_id <> v_comp
     and d.parent_distributor_id is distinct from v_comp
   limit 1;

  -- Mulai dari keadaan bersih untuk dua jenis dokumen uji.
  delete from public.claim_document_type_uploaders where document_type_id in (v_doc, v_doc2);
  delete from public.distributor_claim_checklists where campaign_id = v_c1 and document_type_id in (v_doc, v_doc2);
  delete from public.campaign_files where campaign_id = v_c1 and document_type_id in (v_doc, v_doc2);

  -- ============================================================
  -- A. Fungsi
  -- ============================================================

  -- A1. tanpa penunjukan: tidak terkunci
  if public.claim_document_is_locked(v_c1, v_doc) then raise exception 'GAGAL: tanpa penunjukan, item tidak boleh terkunci'; end if;

  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);

  -- A2. SKP perusahaan sendiri: terkunci, akun yang ditunjuk efektif
  if not public.claim_document_is_locked(v_c1, v_doc) then raise exception 'GAGAL: SKP perusahaan pengunggah khusus harus terkunci'; end if;
  if not public.is_claim_document_special_uploader(v_c1, v_doc, v_pusat) then raise exception 'GAGAL: akun yang ditunjuk harus pengunggah khusus efektif'; end if;
  if public.is_claim_document_special_uploader(v_c1, v_doc, v_rekan) then raise exception 'GAGAL: rekan yang tidak ditunjuk bukan pengunggah khusus'; end if;
  if (select count(*) from public.claim_document_special_uploader_ids(v_c1, v_doc)) <> 1 then raise exception 'GAGAL: daftar efektif harus berisi tepat satu akun'; end if;

  -- A3. jenis dokumen lain tidak ikut terkunci
  if public.claim_document_is_locked(v_c1, v_doc2) then raise exception 'GAGAL: jenis dokumen tanpa penunjukan tidak boleh terkunci'; end if;

  -- A4. SKP anak perusahaan ikut terkunci (pengunggah khusus dari induk)
  if v_c2 is not null then
    if not public.claim_document_is_locked(v_c2, v_doc) then raise exception 'GAGAL: SKP anak perusahaan harus terkunci oleh pengunggah khusus induk'; end if;
    if not public.is_claim_document_special_uploader(v_c2, v_doc, v_pusat) then raise exception 'GAGAL: pengunggah khusus induk harus efektif di SKP anak perusahaan'; end if;
  else
    raise notice 'A4 DILEWATI: tidak ada SKP anak perusahaan dari perusahaan akun Pusat uji';
  end if;

  -- A5. perusahaan yang tidak berhubungan tidak terpengaruh
  if v_c3 is not null then
    if public.claim_document_is_locked(v_c3, v_doc) then raise exception 'GAGAL: SKP perusahaan di luar grup tidak boleh terkunci'; end if;
  else
    raise notice 'A5 DILEWATI: tidak ada SKP perusahaan lain di luar grup';
  end if;

  -- A6. akun nonaktif tidak dihitung → kembali ke aturan lama
  update public.users set is_active = false where id = v_pusat;
  if public.claim_document_is_locked(v_c1, v_doc) then raise exception 'GAGAL: pengunggah khusus nonaktif tidak boleh mengunci item'; end if;
  if public.is_claim_document_special_uploader(v_c1, v_doc, v_pusat) then raise exception 'GAGAL: akun nonaktif bukan pengunggah khusus efektif'; end if;
  update public.users set is_active = true where id = v_pusat;
  if not public.claim_document_is_locked(v_c1, v_doc) then raise exception 'GAGAL: item harus terkunci lagi setelah akun diaktifkan'; end if;

  -- A7. claim_document_has_file mengikuti keberadaan file
  if public.claim_document_has_file(v_c1, v_doc) then raise exception 'GAGAL: belum ada file, has_file harus false'; end if;
  insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
  values (v_c1, 'tes.pdf', 'tes/083-a.pdf', 'application/pdf', 1, v_pusat, v_doc)
  returning id into v_file;
  if not public.claim_document_has_file(v_c1, v_doc) then raise exception 'GAGAL: sudah ada file, has_file harus true'; end if;
  delete from public.campaign_files where id = v_file;

  raise notice 'A LOLOS: fungsi pengunggah khusus efektif dan item terkunci';

  -- ============================================================
  -- B. RLS: tambah file dan checklist
  -- ============================================================
  if v_rekan is null then
    raise notice 'B DILEWATI: tidak ada rekan seperusahaan yang boleh bertindak';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_rekan, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_rekan::text, true);
  if (select auth.uid()) is distinct from v_rekan then
    raise notice 'B DILEWATI: tidak bisa menyamar sebagai pengguna di sesi ini (auth.uid() tidak mengikuti request.jwt.claims)';
    return;
  end if;

  set local role authenticated;

  -- B1. rekan (bukan pengunggah khusus) tidak bisa menambah file item terkunci
  v_caught := false;
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_c1, 'tes.pdf', 'tes/083-b1.pdf', 'application/pdf', 1, v_rekan, v_doc);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: akun lain tidak boleh menambah file item terkunci'; end if;

  -- B2. item tidak terkunci: aturan lama, rekan boleh menambah file
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_c1, 'tes.pdf', 'tes/083-b2.pdf', 'application/pdf', 1, v_rekan, v_doc2);
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: file item tidak terkunci harus tetap bisa ditambah (aturan lama)';
  end;

  -- B3. centang manual item terkunci ditolak; item tidak terkunci tetap boleh
  v_caught := false;
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_c1, v_rekan, v_doc, true);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: centang manual item terkunci tanpa file harus ditolak'; end if;

  delete from public.campaign_files where campaign_id = v_c1 and document_type_id = v_doc2 and uploaded_by = v_rekan;
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_c1, v_rekan, v_doc2, true);
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: centang manual item tidak terkunci harus tetap boleh';
  end;

  -- B4. pengunggah khusus pun tidak bisa mencentang manual tanpa file
  perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_pusat::text, true);

  v_caught := false;
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_c1, v_pusat, v_doc, true);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: pengunggah khusus tidak boleh mencentang manual tanpa file'; end if;

  -- B5. pengunggah khusus menambah file, lalu centang otomatis lolos
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_c1, 'surat.pdf', 'tes/083-b5.pdf', 'application/pdf', 1, v_pusat, v_doc)
    returning id into v_file;
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menambah file item terkunci';
  end;

  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_c1, v_pusat, v_doc, true)
    on conflict (campaign_id, document_type_id)
    do update set is_fulfilled = excluded.is_fulfilled, distributor_id = excluded.distributor_id;
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: centang otomatis sesudah upload harus lolos';
  end;

  -- B6. melepas centang saat file masih ada ditolak
  v_caught := false;
  begin
    update public.distributor_claim_checklists
       set is_fulfilled = false, distributor_id = v_pusat
     where campaign_id = v_c1 and document_type_id = v_doc;
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: melepas centang item terkunci saat file masih ada harus ditolak'; end if;

  -- B7. hapus file → centang boleh dilepas
  delete from public.campaign_files where id = v_file;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menghapus filenya sendiri'; end if;

  update public.distributor_claim_checklists
     set is_fulfilled = false, distributor_id = v_pusat
   where campaign_id = v_c1 and document_type_id = v_doc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: centang harus bisa dilepas setelah file terakhir dihapus'; end if;

  -- B8. pengunggah khusus dinonaktifkan → rekan kembali bisa menambah file
  reset role;
  update public.users set is_active = false where id = v_pusat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_rekan, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_rekan::text, true);
  set local role authenticated;

  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_c1, 'tes.pdf', 'tes/083-b8.pdf', 'application/pdf', 1, v_rekan, v_doc);
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: tanpa pengunggah khusus aktif, rekan harus kembali bisa menambah file';
  end;

  reset role;
  raise notice 'B LOLOS: RLS tambah file dan checklist untuk item terkunci';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: Pengunggah Khusus Dokumen Klaim Fase 2 (083)'; end $$;

rollback;

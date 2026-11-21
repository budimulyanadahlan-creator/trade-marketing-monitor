-- Tes Pengunggah Khusus Dokumen Klaim Fase 3 (migrasi 084). Jalankan di SQL
-- editor Supabase SETELAH migrasi 084. Semua perubahan di-rollback; gagal =
-- exception "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Menguji jangkauan lintas perusahaan pengunggah khusus dengan menyamar
-- sebagai akun nyata (skenario yang sama dengan specialUploaderReachError di
-- lib/claim-document-uploaders.test.ts):
--   A. SKP anak perusahaan — hanya dokumen terkuncinya yang bisa ditulis.
--   B. Klaim turunan SKP Nasional milik akun lain, termasuk yang dibatalkan.
--   C. SKP induk nasional dan akun yang dinonaktifkan.
--
-- Data uji diambil dari data nyata: satu akun Pusat aktif yang perusahaannya
-- punya anak perusahaan dengan SKP Sales/TM Disetujui/Berjalan. Bagian yang
-- datanya tidak tersedia dilewati dengan notice.

begin;

do $$
begin
  if to_regprocedure('public.claim_document_special_upload_reach(uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 084_claim_document_special_upload_reach.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_doc    uuid := (select id from public.claim_document_types order by sort_order, id limit 1);
  v_doc2   uuid := (select id from public.claim_document_types order by sort_order, id offset 1 limit 1);
  v_admin  uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_pusat  uuid;   -- akun Pusat perusahaan induk yang akan ditunjuk
  v_comp   uuid;   -- perusahaan akun itu (induk)
  v_rekan  uuid;   -- akun Pusat lain seperusahaan, bukan pengunggah khusus (opsional)
  v_anak   uuid;   -- SKP anak perusahaan, Disetujui/Berjalan
  v_child  uuid;   -- klaim turunan milik akun lain di grup, Disetujui/Berjalan (opsional)
  v_owner  uuid;   -- pemilik klaim turunan itu
  v_nat    uuid;   -- SKP induk nasional (opsional)
  v_file   uuid;
  v_caught boolean;
  v_ok     boolean;
  v_n      integer;
begin
  -- Akun Pusat induk + SKP biasa milik anak perusahaannya.
  select u.id, u.distributor_id, c.id
    into v_pusat, v_comp, v_anak
    from public.users u
    join public.distributors d on d.parent_distributor_id = u.distributor_id
    join public.campaigns c on c.distributor_id = d.id
    join public.departments dep on dep.id = c.department_id
   where u.role = 'distributor' and u.is_active and u.distributor_scope = 'pusat'
     and c.status in ('approved', 'ongoing')
     and c.is_national is not true
     and c.parent_campaign_id is null
     and lower(trim(dep.name)) in ('sales', 'trade marketing')
   order by c.created_at desc
   limit 1;

  if v_doc is null or v_doc2 is null or v_admin is null or v_pusat is null then
    raise notice 'DILEWATI: butuh 2 jenis dokumen klaim, admin aktif, dan akun Pusat aktif yang perusahaannya punya anak perusahaan dengan SKP Sales/TM Disetujui/Berjalan';
    return;
  end if;

  select r.id into v_rekan
    from public.users r
   where r.role = 'distributor' and r.is_active
     and r.distributor_id = v_comp and r.distributor_scope = 'pusat'
     and r.id <> v_pusat
   limit 1;

  select c.id, c.claim_owner_id into v_child, v_owner
    from public.campaigns c
    join public.distributors d on d.id = c.distributor_id
    join public.users o on o.id = c.claim_owner_id
   where c.parent_campaign_id is not null
     and c.status in ('approved', 'ongoing')
     and (c.distributor_id = v_comp or d.parent_distributor_id = v_comp)
     and c.claim_owner_id <> v_pusat
     and o.role = 'distributor' and o.is_active
   order by c.created_at desc
   limit 1;

  select c.id into v_nat
    from public.campaigns c
   where c.is_national and c.status in ('approved', 'ongoing')
   limit 1;

  -- Keadaan bersih untuk dua jenis dokumen uji, lalu tunjuk akun Pusat induk.
  delete from public.claim_document_type_uploaders where document_type_id in (v_doc, v_doc2);
  delete from public.distributor_claim_checklists
   where campaign_id in (v_anak, v_child) and document_type_id in (v_doc, v_doc2);
  delete from public.campaign_files
   where campaign_id in (v_anak, v_child) and document_type_id in (v_doc, v_doc2);

  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);

  -- Menyamar sebagai pengunggah khusus.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_pusat::text, true);
  if (select auth.uid()) is distinct from v_pusat then
    raise notice 'DILEWATI: tidak bisa menyamar sebagai pengguna di sesi ini (auth.uid() tidak mengikuti request.jwt.claims)';
    return;
  end if;

  -- ============================================================
  -- A. SKP anak perusahaan
  -- ============================================================
  set local role authenticated;

  -- A1. prasyarat: akses SKP-nya hanya lihat
  if public.distributor_campaign_access_by_id(v_anak, public.distributor_viewer_ctx()) is distinct from 'view' then
    reset role; raise exception 'GAGAL: Pusat induk seharusnya hanya bisa melihat SKP anak perusahaan';
  end if;

  -- A2. menjangkau dokumen terkuncinya, tidak dokumen lain
  if not public.claim_document_special_upload_reach(v_anak, v_doc) then
    reset role; raise exception 'GAGAL: pengunggah khusus induk harus menjangkau SKP anak perusahaan';
  end if;
  if public.claim_document_special_upload_reach(v_anak, v_doc2) then
    reset role; raise exception 'GAGAL: jangkauan hanya untuk jenis dokumen yang ditunjuk';
  end if;

  -- A3. dokumen lain di SKP itu tetap ditolak (hanya lihat)
  v_caught := false;
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_anak, 'tes.pdf', 'tes/084-a3.pdf', 'application/pdf', 1, v_pusat, v_doc2);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: dokumen lain di SKP anak perusahaan harus tetap ditolak'; end if;

  -- A4. centang tanpa file ditolak, juga untuk pengunggah khusus
  v_caught := false;
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_anak, v_pusat, v_doc, true);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: centang manual tanpa file harus ditolak di SKP anak perusahaan'; end if;

  -- A5. upload dokumen terkunci berhasil
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_anak, 'surat.pdf', 'tes/084-a5.pdf', 'application/pdf', 1, v_pusat, v_doc)
    returning id into v_file;
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menambah file dokumen terkunci di SKP anak perusahaan';
  end;

  -- A6. centang otomatis sesudah upload lolos walau hanya akses lihat
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_anak, v_pusat, v_doc, true)
    on conflict (campaign_id, document_type_id)
    do update set is_fulfilled = excluded.is_fulfilled, distributor_id = excluded.distributor_id;
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: centang otomatis sesudah upload harus lolos di SKP anak perusahaan';
  end;

  -- A7. checklist dokumen lain di SKP itu tetap ditolak
  v_caught := false;
  begin
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_anak, v_pusat, v_doc2, true);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: centang dokumen lain di SKP anak perusahaan harus ditolak'; end if;

  -- A8. melepas centang saat file masih ada ditolak
  v_caught := false;
  begin
    update public.distributor_claim_checklists
       set is_fulfilled = false, distributor_id = v_pusat
     where campaign_id = v_anak and document_type_id = v_doc;
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: melepas centang saat file masih ada harus ditolak'; end if;

  -- A9. hapus file sendiri → centang boleh dilepas
  delete from public.campaign_files where id = v_file;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menghapus filenya di SKP anak perusahaan'; end if;

  update public.distributor_claim_checklists
     set is_fulfilled = false, distributor_id = v_pusat
   where campaign_id = v_anak and document_type_id = v_doc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: centang harus lepas setelah file terakhir dihapus'; end if;

  -- A10. Pusat induk lain yang tidak ditunjuk tetap tidak bisa
  if v_rekan is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_rekan, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_rekan::text, true);
    if public.claim_document_special_upload_reach(v_anak, v_doc) then
      reset role; raise exception 'GAGAL: akun Pusat yang tidak ditunjuk tidak boleh menjangkau';
    end if;
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_anak, 'tes.pdf', 'tes/084-a10.pdf', 'application/pdf', 1, v_rekan, v_doc);
    exception when insufficient_privilege then v_caught := true;
    end;
    if not v_caught then reset role; raise exception 'GAGAL: akun Pusat yang tidak ditunjuk tidak boleh menambah file di SKP anak perusahaan'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_pusat::text, true);
  else
    raise notice 'A10 DILEWATI: tidak ada akun Pusat lain di perusahaan induk';
  end if;

  raise notice 'A LOLOS: jangkauan ke SKP anak perusahaan';

  -- ============================================================
  -- B. Klaim turunan SKP Nasional milik akun lain
  -- ============================================================
  if v_child is null then
    raise notice 'B DILEWATI: tidak ada klaim turunan Disetujui/Berjalan milik akun lain di grup perusahaan ini';
  else
    -- B1. menjangkau, upload + centang otomatis lolos
    if not public.claim_document_special_upload_reach(v_child, v_doc) then
      reset role; raise exception 'GAGAL: pengunggah khusus harus menjangkau klaim turunan milik akun lain';
    end if;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_child, 'surat.pdf', 'tes/084-b1.pdf', 'application/pdf', 1, v_pusat, v_doc)
      returning id into v_file;
      insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
      values (v_child, v_pusat, v_doc, true)
      on conflict (campaign_id, document_type_id)
      do update set is_fulfilled = excluded.is_fulfilled, distributor_id = excluded.distributor_id;
    exception when insufficient_privilege then
      reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menambah file + centang di klaim turunan milik akun lain';
    end;

    -- B2. dokumen lain di klaim turunan itu tetap ditolak
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_child, 'tes.pdf', 'tes/084-b2.pdf', 'application/pdf', 1, v_pusat, v_doc2);
    exception when insufficient_privilege then v_caught := true;
    end;
    if not v_caught then reset role; raise exception 'GAGAL: dokumen lain di klaim turunan akun lain harus ditolak'; end if;

    delete from public.campaign_files where id = v_file;
    update public.distributor_claim_checklists
       set is_fulfilled = false, distributor_id = v_pusat
     where campaign_id = v_child and document_type_id = v_doc;

    -- B3. pemilik klaim turunan tidak bisa mengunggah item terkunci miliknya
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_child, 'tes.pdf', 'tes/084-b3.pdf', 'application/pdf', 1, v_owner, v_doc);
    exception when insufficient_privilege then v_caught := true;
    end;
    if not v_caught then reset role; raise exception 'GAGAL: pemilik klaim turunan tidak boleh mengunggah item terkunci'; end if;

    -- B4. dokumen tidak terkunci: pemilik tetap boleh (aturan lama)
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_child, 'tes.pdf', 'tes/084-b4.pdf', 'application/pdf', 1, v_owner, v_doc2);
    exception when insufficient_privilege then
      reset role; raise exception 'GAGAL: pemilik klaim turunan harus tetap bisa mengunggah dokumen tidak terkunci';
    end;

    -- B5. turunan dibatalkan → tidak terjangkau lagi
    reset role;
    v_ok := true;
    begin
      update public.campaigns set status = 'cancelled' where id = v_child;
    exception when others then
      v_ok := false;
      raise notice 'B5 DILEWATI: klaim turunan uji tidak bisa dibatalkan langsung (%)', sqlerrm;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_pusat::text, true);
    set local role authenticated;
    if v_ok then
      if public.claim_document_special_upload_reach(v_child, v_doc) then
        reset role; raise exception 'GAGAL: klaim turunan yang dibatalkan tidak boleh terjangkau';
      end if;
      v_caught := false;
      begin
        insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
        values (v_child, 'tes.pdf', 'tes/084-b5.pdf', 'application/pdf', 1, v_pusat, v_doc);
      exception when insufficient_privilege then v_caught := true;
      end;
      if not v_caught then reset role; raise exception 'GAGAL: upload ke klaim turunan yang dibatalkan harus ditolak'; end if;
    end if;

    raise notice 'B LOLOS: jangkauan ke klaim turunan SKP Nasional';
  end if;

  -- ============================================================
  -- C. SKP induk nasional dan akun nonaktif
  -- ============================================================
  if v_nat is not null then
    if public.claim_document_special_upload_reach(v_nat, v_doc) then
      reset role; raise exception 'GAGAL: SKP induk nasional tidak boleh terjangkau';
    end if;
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_nat, 'tes.pdf', 'tes/084-c1.pdf', 'application/pdf', 1, v_pusat, v_doc);
    -- Ditolak RLS, atau lebih dulu oleh trigger reject_national_parent_activity (074).
    exception when insufficient_privilege or check_violation then v_caught := true;
    end;
    if not v_caught then reset role; raise exception 'GAGAL: upload dokumen klaim ke SKP induk nasional harus ditolak'; end if;
  else
    raise notice 'C1 DILEWATI: tidak ada SKP induk nasional Disetujui/Berjalan';
  end if;

  -- C2. pengunggah khusus dinonaktifkan → tidak menjangkau apa pun
  reset role;
  update public.users set is_active = false where id = v_pusat;
  set local role authenticated;
  if public.claim_document_special_upload_reach(v_anak, v_doc) then
    reset role; raise exception 'GAGAL: akun nonaktif tidak boleh menjangkau';
  end if;

  reset role;
  raise notice 'C LOLOS: induk nasional dan akun nonaktif';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: Pengunggah Khusus Dokumen Klaim Fase 3 (084)'; end $$;

rollback;

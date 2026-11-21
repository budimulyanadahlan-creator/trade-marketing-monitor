-- Tes Pengunggah Khusus Dokumen Klaim Fase 4 (migrasi 085). Jalankan di SQL
-- editor Supabase SETELAH migrasi 085. Semua perubahan di-rollback; gagal =
-- exception "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Menguji jendela status item terkunci sesudah klaim diajukan (skenario yang
-- sama dengan specialDocumentWindowError di
-- lib/claim-document-uploaders.test.ts):
--   A. Klaim Diajukan — pengunggah khusus (bukan pemegang klaim) menambah file
--      selama item belum Accept; ditolak setelah Accept.
--   B. Pemegang klaim cabang — item terkunci tetap ditolak; item tidak
--      terkunci tetap aturan lama (hanya saat diminta revisi).
--   C. Status sesudah Klaim Diajukan — tertutup.
--
-- Data uji diambil dari data nyata, sama seperti tes 084: satu akun Pusat
-- aktif yang perusahaannya punya anak perusahaan dengan SKP Sales/TM
-- Disetujui/Berjalan. SKP itu dipindah ke Klaim Diajukan di dalam transaksi.
-- Bagian yang datanya tidak tersedia dilewati dengan notice.

begin;

do $$
begin
  if to_regprocedure('public.claim_document_special_upload_open(uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 085_claim_document_special_upload_window.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
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
  v_anak   uuid;   -- SKP anak perusahaan, dipindah ke Klaim Diajukan
  v_holder uuid;   -- akun perusahaan SKP yang dijadikan pemegang klaim (opsional)
  v_file   uuid;
  v_caught boolean;
  v_n      integer;
  s        text;
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

  -- Pemegang klaim: akun aktif perusahaan SKP itu sendiri yang boleh bertindak
  -- (Pusat perusahaan itu, atau cabang region SKP).
  select h.id into v_holder
    from public.users h
    join public.campaigns c on c.id = v_anak
   where h.role = 'distributor' and h.is_active
     and h.distributor_id = c.distributor_id
     and h.id <> v_pusat
     and (h.distributor_scope = 'pusat' or h.region_id = c.region_id)
   order by (h.distributor_scope = 'pusat') desc
   limit 1;

  -- Keadaan bersih untuk dua jenis dokumen uji, lalu tunjuk akun Pusat induk.
  delete from public.claim_document_type_uploaders where document_type_id in (v_doc, v_doc2);
  delete from public.distributor_claim_checklists
   where campaign_id = v_anak and document_type_id in (v_doc, v_doc2);
  delete from public.campaign_files
   where campaign_id = v_anak and document_type_id in (v_doc, v_doc2);
  delete from public.claim_item_verifications
   where campaign_id = v_anak and document_type_id in (v_doc, v_doc2);

  insert into public.claim_document_type_uploaders (document_type_id, user_id, created_by)
  values (v_doc, v_pusat, v_admin);

  -- SKP uji → Klaim Diajukan, dipegang akun lain (bukan pengunggah khusus).
  begin
    update public.campaigns
       set status = 'claim_submitted',
           claim_amount = coalesce(claim_amount, 1000),
           claim_submitted_at = now(),
           claim_submitted_by = v_holder
     where id = v_anak;
  exception when others then
    raise notice 'DILEWATI: SKP uji tidak bisa dipindah ke Klaim Diajukan (%)', sqlerrm;
    return;
  end;

  -- Menyamar sebagai pengunggah khusus.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_pusat::text, true);
  if (select auth.uid()) is distinct from v_pusat then
    raise notice 'DILEWATI: tidak bisa menyamar sebagai pengguna di sesi ini (auth.uid() tidak mengikuti request.jwt.claims)';
    return;
  end if;

  -- ============================================================
  -- A. Klaim Diajukan — pengunggah khusus, bukan pemegang klaim
  -- ============================================================
  set local role authenticated;

  -- A1. item masih kosong (belum ada baris verifikasi): terbuka
  if not public.claim_document_special_upload_open(v_anak, v_doc) then
    reset role; raise exception 'GAGAL: jendela harus terbuka saat Klaim Diajukan dan item belum punya baris verifikasi';
  end if;
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_anak, 'surat.pdf', 'tes/085-a1.pdf', 'application/pdf', 1, v_pusat, v_doc)
    returning id into v_file;
    insert into public.distributor_claim_checklists (campaign_id, distributor_id, document_type_id, is_fulfilled)
    values (v_anak, v_pusat, v_doc, true)
    on conflict (campaign_id, document_type_id)
    do update set is_fulfilled = excluded.is_fulfilled, distributor_id = excluded.distributor_id;
  exception when insufficient_privilege then
    reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menambah file + centang saat Klaim Diajukan (item kosong)';
  end;

  -- A2. hapus file sendiri + lepas centang tetap lolos sesudah submit
  delete from public.campaign_files where id = v_file;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menghapus filenya saat Klaim Diajukan'; end if;
  update public.distributor_claim_checklists
     set is_fulfilled = false, distributor_id = v_pusat
   where campaign_id = v_anak and document_type_id = v_doc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then reset role; raise exception 'GAGAL: centang harus lepas setelah file terakhir dihapus saat Klaim Diajukan'; end if;

  -- A3. menunggu diperiksa dan diminta revisi: terbuka
  foreach s in array array['pending', 'revision_requested'] loop
    reset role;
    insert into public.claim_item_verifications (campaign_id, item_type, document_type_id, status)
    values (v_anak, 'document', v_doc, s)
    on conflict (campaign_id, document_type_id) do update set status = excluded.status;
    set local role authenticated;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_anak, 'surat.pdf', 'tes/085-a3-' || s || '.pdf', 'application/pdf', 1, v_pusat, v_doc);
    exception when insufficient_privilege then
      reset role; raise exception 'GAGAL: pengunggah khusus harus bisa menambah file saat item berstatus %', s;
    end;
  end loop;

  -- A4. sudah Accept: tertutup
  reset role;
  update public.claim_item_verifications set status = 'accepted'
   where campaign_id = v_anak and document_type_id = v_doc;
  set local role authenticated;
  if public.claim_document_special_upload_open(v_anak, v_doc) then
    reset role; raise exception 'GAGAL: jendela harus tertutup setelah item di-Accept';
  end if;
  v_caught := false;
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_anak, 'tes.pdf', 'tes/085-a4.pdf', 'application/pdf', 1, v_pusat, v_doc);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: upload setelah item di-Accept harus ditolak'; end if;

  -- A5. dokumen lain (tidak terkunci) di SKP itu tetap ditolak, juga saat revisi
  reset role;
  insert into public.claim_item_verifications (campaign_id, item_type, document_type_id, status)
  values (v_anak, 'document', v_doc2, 'revision_requested')
  on conflict (campaign_id, document_type_id) do update set status = excluded.status;
  set local role authenticated;
  v_caught := false;
  begin
    insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
    values (v_anak, 'tes.pdf', 'tes/085-a5.pdf', 'application/pdf', 1, v_pusat, v_doc2);
  exception when insufficient_privilege then v_caught := true;
  end;
  if not v_caught then reset role; raise exception 'GAGAL: dokumen tidak terkunci di SKP anak perusahaan harus tetap ditolak untuk pengunggah khusus'; end if;

  raise notice 'A LOLOS: pengunggah khusus sesudah klaim diajukan';

  -- ============================================================
  -- B. Pemegang klaim cabang
  -- ============================================================
  if v_holder is null then
    raise notice 'B DILEWATI: tidak ada akun aktif perusahaan SKP uji untuk dijadikan pemegang klaim';
  else
    reset role;
    update public.claim_item_verifications set status = 'revision_requested'
     where campaign_id = v_anak and document_type_id = v_doc;
    perform set_config('request.jwt.claims', json_build_object('sub', v_holder, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_holder::text, true);
    set local role authenticated;

    if public.distributor_campaign_access_by_id(v_anak, public.distributor_viewer_ctx()) is distinct from 'act' then
      raise notice 'B DILEWATI: akun pemegang klaim uji tidak punya hak bertindak atas SKP uji';
    else
      -- B1. item terkunci tetap ditolak, juga saat diminta revisi
      v_caught := false;
      begin
        insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
        values (v_anak, 'tes.pdf', 'tes/085-b1.pdf', 'application/pdf', 1, v_holder, v_doc);
      exception when insufficient_privilege then v_caught := true;
      end;
      if not v_caught then reset role; raise exception 'GAGAL: pemegang klaim tidak boleh mengunggah item terkunci walau diminta revisi'; end if;

      -- B2. item tidak terkunci, diminta revisi: aturan lama → boleh
      begin
        insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
        values (v_anak, 'tes.pdf', 'tes/085-b2.pdf', 'application/pdf', 1, v_holder, v_doc2);
      exception when insufficient_privilege then
        reset role; raise exception 'GAGAL: pemegang klaim harus tetap bisa mengunggah revisi item tidak terkunci';
      end;

      -- B3. item tidak terkunci, menunggu diperiksa: aturan lama → ditolak
      reset role;
      update public.claim_item_verifications set status = 'pending'
       where campaign_id = v_anak and document_type_id = v_doc2;
      set local role authenticated;
      v_caught := false;
      begin
        insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
        values (v_anak, 'tes.pdf', 'tes/085-b3.pdf', 'application/pdf', 1, v_holder, v_doc2);
      exception when insufficient_privilege then v_caught := true;
      end;
      if not v_caught then reset role; raise exception 'GAGAL: item tidak terkunci yang belum diminta revisi harus tetap terkunci sesudah submit'; end if;

      raise notice 'B LOLOS: pemegang klaim — item terkunci ditolak, aturan lama tidak berubah';
    end if;
  end if;

  -- ============================================================
  -- C. Status sesudah Klaim Diajukan
  -- ============================================================
  reset role;
  update public.claim_item_verifications set status = 'pending'
   where campaign_id = v_anak and document_type_id = v_doc;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pusat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_pusat::text, true);

  foreach s in array array['claim_verified', 'ready_to_pay', 'paid', 'completed'] loop
    reset role;
    begin
      update public.campaigns set status = s::public.campaign_status where id = v_anak;
    exception when others then
      raise notice 'C (%) DILEWATI: SKP uji tidak bisa dipindah langsung (%)', s, sqlerrm;
      continue;
    end;
    set local role authenticated;
    if public.claim_document_special_upload_open(v_anak, v_doc) then
      reset role; raise exception 'GAGAL: jendela harus tertutup pada status %', s;
    end if;
    v_caught := false;
    begin
      insert into public.campaign_files (campaign_id, file_name, file_url, file_type, file_size, uploaded_by, document_type_id)
      values (v_anak, 'tes.pdf', 'tes/085-c-' || s || '.pdf', 'application/pdf', 1, v_pusat, v_doc);
    exception when insufficient_privilege then v_caught := true;
    end;
    if not v_caught then reset role; raise exception 'GAGAL: upload pada status % harus ditolak', s; end if;
  end loop;

  reset role;
  raise notice 'C LOLOS: status sesudah Klaim Diajukan tertutup';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: Pengunggah Khusus Dokumen Klaim Fase 4 (085)'; end $$;

rollback;

-- Tes SKP Nasional Fase 8 (migrasi 081). Jalankan di SQL editor Supabase
-- SETELAH migrasi 081. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Membuat klaim turunan di atas satu SKP Disetujui nyata lalu mengalihkan
-- kepemilikannya, dengan skenario yang sama dengan transferChildOwnerError
-- (lib/national-skp.test.ts). Dilewati dengan notice bila tidak ada SKP atau
-- dua akun distributor aktif dari satu perusahaan untuk diuji.

begin;

do $$
begin
  if to_regprocedure('public.transfer_national_child_owner(uuid, uuid, uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 081_national_child_owner_transfer.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_parent   uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_admin    uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_finance  uuid := (select id from public.users where role = 'finance' and is_active limit 1);
  v_company  uuid;
  u1         public.users;  -- pemilik awal
  u2         public.users;  -- rekan seperusahaan (pemilik baru)
  u3         public.users;  -- akun perusahaan lain (boleh kosong)
  k          public.campaigns;
  k0         public.campaigns;
  v_k1       uuid;
  v_k2       uuid;
  v_caught   boolean;
  v_events   integer;
  v_items    integer;
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

  -- Perusahaan dengan minimal dua akun distributor aktif.
  select distributor_id into v_company
    from public.users
   where role = 'distributor' and is_active and distributor_id is not null
   group by distributor_id
  having count(*) >= 2
   limit 1;

  select * into u1 from public.users
   where role = 'distributor' and is_active and distributor_id = v_company
   order by id limit 1;
  select * into u2 from public.users
   where role = 'distributor' and is_active and distributor_id = v_company and id <> u1.id
   order by id limit 1;
  select * into u3 from public.users
   where role = 'distributor' and is_active and distributor_id is not null and distributor_id <> v_company
   order by id limit 1;

  if v_parent is null or v_national is null or v_admin is null or u1.id is null or u2.id is null then
    raise notice 'DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, admin, atau dua akun distributor aktif dari satu perusahaan untuk diuji';
    return;
  end if;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-081')
   where id = v_parent;

  v_k1 := public.create_national_child_claim(v_parent, u1.id);  -- -K01, milik u1
  select * into k0 from public.campaigns where id = v_k1;

  -- 1. hanya admin/superadmin
  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_k1, u1.id, u2.id, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: pemilik tidak boleh mengalihkan klaimnya sendiri'; end if;

  if v_finance is not null then
    v_caught := false;
    begin
      perform public.transfer_national_child_owner(v_k1, v_finance, u2.id, u1.id);
    exception when raise_exception then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: Finance tidak boleh mengalihkan kepemilikan'; end if;
  end if;

  -- 2. SKP induk bukan klaim turunan
  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_parent, v_admin, u2.id, null);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: SKP induk tidak boleh dialihkan kepemilikannya'; end if;

  -- 3. akun tujuan tidak sah: pemilik sendiri, non-distributor, perusahaan lain
  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_k1, v_admin, u1.id, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: pemilik saat ini bukan tujuan yang sah'; end if;

  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_k1, v_admin, v_admin, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: akun non-distributor tidak boleh menjadi pemilik'; end if;

  if u3.id is not null then
    v_caught := false;
    begin
      perform public.transfer_national_child_owner(v_k1, v_admin, u3.id, u1.id);
    exception when raise_exception then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: akun perusahaan lain tidak boleh menjadi pemilik'; end if;

    -- UPDATE langsung pun ditolak trigger
    v_caught := false;
    begin
      update public.campaigns set claim_owner_id = u3.id where id = v_k1;
    exception when check_violation then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: UPDATE langsung pemilik ke akun perusahaan lain harus ditolak'; end if;
  end if;

  -- 4. pemilik sudah berubah sejak halaman dimuat (pemilik yang diharapkan salah)
  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_k1, v_admin, u2.id, u2.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: pengalihan harus ditolak bila pemilik yang diharapkan tidak cocok'; end if;

  -- 5. akun tujuan punya klaim lain yang belum diajukan atas induk yang sama
  v_k2 := public.create_national_child_claim(v_parent, u2.id);  -- -K02, milik u2, terbuka
  v_caught := false;
  begin
    perform public.transfer_national_child_owner(v_k1, v_admin, u2.id, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: pengalihan harus ditolak bila akun tujuan punya klaim terbuka atas induk yang sama'; end if;
  perform public.cancel_national_child_claim(v_k2, u2.id);

  -- 6. pengalihan pada status Disetujui: pemilik pindah, pemegang tidak tersentuh,
  --    region/perusahaan/nomor/status tetap, tercatat di riwayat
  perform public.transfer_national_child_owner(v_k1, v_admin, u2.id, u1.id);
  select * into k from public.campaigns where id = v_k1;
  if k.claim_owner_id <> u2.id then raise exception 'GAGAL: pemilik harus berpindah ke akun tujuan'; end if;
  if k.claim_submitted_by is not null then raise exception 'GAGAL: pemegang klaim tidak boleh terisi saat klaim belum diajukan'; end if;
  if k.region_id is distinct from k0.region_id or k.distributor_id is distinct from k0.distributor_id
     or k.skp_number is distinct from k0.skp_number or k.status is distinct from k0.status
     or k.child_seq is distinct from k0.child_seq then
    raise exception 'GAGAL: region, perusahaan, nomor, dan status turunan tidak boleh berubah saat dialihkan';
  end if;
  select count(*) into v_events from public.claim_events
   where campaign_id = v_k1 and action = 'owner_transferred'
     and actor_id = v_admin and from_user_id = u1.id and to_user_id = u2.id;
  if v_events <> 1 then raise exception 'GAGAL: pengalihan harus tercatat sekali di riwayat klaim dengan pelaku, pemilik lama, dan pemilik baru (dapat %)', v_events; end if;

  -- 7. akses: pemilik baru act; pemilik lama (cabang) tidak lagi melihat
  if public.distributor_campaign_access_by_id(v_k1, row(u2.id, u2.distributor_id, 'cabang', u2.region_id)::public.distributor_viewer) is distinct from 'act' then
    raise exception 'GAGAL: pemilik baru harus bisa bertindak';
  end if;
  if public.distributor_campaign_access_by_id(v_k1, row(u1.id, u1.distributor_id, 'cabang', u1.region_id)::public.distributor_viewer) is not null then
    raise exception 'GAGAL: pemilik lama (cabang) tidak boleh lagi melihat turunan';
  end if;
  if public.distributor_campaign_access_by_id(v_k1, row(u1.id, u1.distributor_id, 'pusat', null)::public.distributor_viewer) is distinct from 'view' then
    raise exception 'GAGAL: pemilik lama yang akun pusat harus tetap bisa melihat (hanya lihat)';
  end if;

  -- 8. pada Klaim Diajukan pemegang ikut berpindah; status & verifikasi item tetap
  update public.campaigns
     set status = 'claim_submitted', claim_amount = 1000, claim_submitted_at = now(), claim_submitted_by = u2.id
   where id = v_k1;
  select count(*) into v_items from public.claim_item_verifications where campaign_id = v_k1;

  perform public.transfer_national_child_owner(v_k1, v_admin, u1.id, u2.id);
  select * into k from public.campaigns where id = v_k1;
  if k.claim_owner_id <> u1.id or k.claim_submitted_by is distinct from u1.id then
    raise exception 'GAGAL: pada Klaim Diajukan pemilik dan pemegang klaim harus berpindah bersama';
  end if;
  if k.status <> 'claim_submitted' or k.claim_amount <> 1000 then
    raise exception 'GAGAL: status dan nominal klaim tidak boleh berubah saat dialihkan';
  end if;
  if (select count(*) from public.claim_item_verifications where campaign_id = v_k1) <> v_items then
    raise exception 'GAGAL: verifikasi per item tidak boleh berubah saat dialihkan';
  end if;

  -- 9. setelah Klaim Diajukan (mis. Terverifikasi) pemegang tetap, pemilik pindah
  update public.campaigns set status = 'claim_verified' where id = v_k1;
  perform public.transfer_national_child_owner(v_k1, v_admin, u2.id, u1.id);
  select * into k from public.campaigns where id = v_k1;
  if k.claim_owner_id <> u2.id then raise exception 'GAGAL: pengalihan harus berlaku pada status Terverifikasi'; end if;
  if k.claim_submitted_by is distinct from u1.id then raise exception 'GAGAL: di luar Klaim Diajukan pemegang klaim tidak boleh berubah'; end if;

  select count(*) into v_events from public.claim_events
   where campaign_id = v_k1 and action = 'owner_transferred';
  if v_events <> 3 then raise exception 'GAGAL: tiap pengalihan harus tercatat (harap 3, dapat %)', v_events; end if;

  raise notice 'LOLOS: alih kepemilikan klaim turunan';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 8 (081)'; end $$;

rollback;

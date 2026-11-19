-- Tes SKP Nasional Fase 6 (migrasi 079). Jalankan di SQL editor Supabase
-- SETELAH migrasi 079. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Menjadikan satu SKP Disetujui nyata sebagai induk nasional, membuat satu
-- klaim turunan, lalu mencari nomor induk di pemilih SKP POSM/Gimmick dan
-- Event sebagai admin: induk harus muncul, klaim turunan tidak. Dilewati
-- dengan notice bila tidak ada SKP / akun yang cocok.

begin;

do $$
begin
  if to_regprocedure('public.create_national_child_claim(uuid, uuid)') is null then
    raise exception 'GAGAL: migrasi 075_national_child_claims.sql belum dijalankan';
  end if;
  if position('parent_campaign_id' in pg_get_functiondef('public.search_posm_campaigns(text)'::regprocedure)) = 0
     or position('parent_campaign_id' in pg_get_functiondef('public.search_event_campaigns(text)'::regprocedure)) = 0 then
    raise exception 'GAGAL: migrasi 079_national_child_hidden_from_pickers.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_parent   uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_admin    uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  v_owner    uuid := (select id from public.users
                       where role = 'distributor' and is_active and distributor_id is not null
                       order by id limit 1);
  v_child    uuid;
  v_number   text := 'TES-079-INDUK';
  v_n        int;
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

  if v_parent is null or v_national is null or v_admin is null or v_owner is null then
    raise notice 'DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, admin, atau akun distributor aktif berperusahaan untuk diuji';
    return;
  end if;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national, skp_number = v_number
   where id = v_parent;
  v_child := public.create_national_child_claim(v_parent, v_owner);

  if (select skp_number from public.campaigns where id = v_child) not like v_number || '-K%' then
    raise exception 'GAGAL: prasyarat — nomor klaim turunan harus berawalan nomor induk';
  end if;

  -- Pencarian dijalankan sebagai admin (can_manage_posm membaca auth.uid()).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('test.uid', v_admin::text, true);

  if not public.can_manage_posm() then
    raise notice 'DILEWATI: tidak bisa menyamar sebagai admin di sesi ini (auth.uid() tidak mengikuti request.jwt.claims)';
    return;
  end if;

  -- 1. pemilih POSM / Gimmick
  select count(*) into v_n from public.search_posm_campaigns(v_number) s where s.id = v_parent;
  if v_n <> 1 then raise exception 'GAGAL: SKP induk nasional harus muncul di pemilih SKP POSM'; end if;
  select count(*) into v_n from public.search_posm_campaigns(v_number) s where s.id = v_child;
  if v_n <> 0 then raise exception 'GAGAL: klaim turunan tidak boleh muncul di pemilih SKP POSM'; end if;

  -- 2. pemilih Event
  select count(*) into v_n from public.search_event_campaigns(v_number) s where s.id = v_parent;
  if v_n <> 1 then raise exception 'GAGAL: SKP induk nasional harus muncul di pemilih SKP Event'; end if;
  select count(*) into v_n from public.search_event_campaigns(v_number) s where s.id = v_child;
  if v_n <> 0 then raise exception 'GAGAL: klaim turunan tidak boleh muncul di pemilih SKP Event'; end if;

  -- 3. tidak ada baris turunan sama sekali di hasil pencarian
  select count(*) into v_n
    from public.search_posm_campaigns(v_number) s
    join public.campaigns c on c.id = s.id
   where c.parent_campaign_id is not null;
  if v_n <> 0 then raise exception 'GAGAL: hasil pencarian POSM masih memuat klaim turunan'; end if;

  raise notice 'LOLOS: pemilih SKP POSM/Gimmick dan Event menampilkan induk, bukan klaim turunan';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 6 (079)'; end $$;

rollback;

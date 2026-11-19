-- Tes SKP Nasional Fase 5 (migrasi 078). Jalankan di SQL editor Supabase
-- SETELAH migrasi 078. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Membuat dua klaim turunan di atas satu SKP Disetujui nyata lalu menambah,
-- mengubah, dan menghapus realisasinya; setelah tiap langkah actual_spent
-- induk harus sama dengan jumlah actual_spent turunannya. Dilewati dengan
-- notice bila tidak ada SKP / akun yang cocok.

begin;

do $$
begin
  if to_regprocedure('public.sync_national_parent_actual_spent()') is null then
    raise exception 'GAGAL: migrasi 078_national_parent_actual_spent.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_parent   uuid;
  v_other    uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  v_admin    uuid := (select id from public.users where role in ('admin', 'superadmin') and is_active limit 1);
  u1         public.users;
  u2         public.users;
  v_k1       uuid;
  v_k2       uuid;
  v_r1       uuid;
  v_r2       uuid;
  v_spent    bigint;
  v_other_before bigint;
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
    raise notice 'DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, admin, atau dua akun distributor aktif berperusahaan untuk diuji';
    return;
  end if;

  -- SKP biasa lain sebagai pembanding: tidak boleh ikut berubah
  select c.id, c.actual_spent into v_other, v_other_before
    from public.campaigns c
   where c.id <> v_parent and not c.is_national and c.parent_campaign_id is null
   limit 1;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-078')
   where id = v_parent;

  v_k1 := public.create_national_child_claim(v_parent, u1.id);
  v_k2 := public.create_national_child_claim(v_parent, u2.id);

  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 0 then raise exception 'GAGAL: induk tanpa realisasi turunan harus 0 (dapat %)', v_spent; end if;

  -- 1. realisasi pertama pada turunan 1
  insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
  values (v_k1, 'TES-078-A', 1000, current_date, v_admin)
  returning id into v_r1;
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 1000 then raise exception 'GAGAL: setelah realisasi 1000 di turunan 1, induk harus 1000 (dapat %)', v_spent; end if;

  -- 2. realisasi pada turunan 2 → terjumlah
  insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
  values (v_k2, 'TES-078-B', 2500, current_date, v_admin)
  returning id into v_r2;
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 3500 then raise exception 'GAGAL: induk harus 3500 setelah realisasi dua turunan (dapat %)', v_spent; end if;

  -- 3. realisasi kedua pada turunan 1
  insert into public.realizations (campaign_id, invoice_number, amount, realization_date, created_by)
  values (v_k1, 'TES-078-C', 400, current_date, v_admin);
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 3900 then raise exception 'GAGAL: induk harus 3900 setelah realisasi kedua turunan 1 (dapat %)', v_spent; end if;

  -- 4. realisasi diubah
  update public.realizations set amount = 2000 where id = v_r2;
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 3400 then raise exception 'GAGAL: induk harus 3400 setelah realisasi turunan 2 diubah (dapat %)', v_spent; end if;

  -- 5. realisasi dihapus
  delete from public.realizations where id = v_r1;
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 2400 then raise exception 'GAGAL: induk harus 2400 setelah realisasi turunan 1 dihapus (dapat %)', v_spent; end if;

  -- 6. induk selalu sama dengan jumlah turunannya
  if v_spent is distinct from (
    select coalesce(sum(k.actual_spent), 0) from public.campaigns k where k.parent_campaign_id = v_parent
  ) then
    raise exception 'GAGAL: actual_spent induk tidak sama dengan jumlah actual_spent turunannya';
  end if;

  -- 7. semua realisasi turunan 2 dihapus → hanya sisa turunan 1
  delete from public.realizations where campaign_id = v_k2;
  select actual_spent into v_spent from public.campaigns where id = v_parent;
  if v_spent <> 400 then raise exception 'GAGAL: induk harus 400 setelah semua realisasi turunan 2 dihapus (dapat %)', v_spent; end if;

  -- 8. SKP biasa tidak tersentuh
  if v_other is not null and (select actual_spent from public.campaigns where id = v_other) is distinct from v_other_before then
    raise exception 'GAGAL: actual_spent SKP lain tidak boleh berubah';
  end if;

  raise notice 'LOLOS: actual_spent induk mengikuti realisasi turunan (tambah, ubah, hapus)';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 5 (078)'; end $$;

rollback;

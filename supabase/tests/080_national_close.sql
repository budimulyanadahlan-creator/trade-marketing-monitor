-- Tes SKP Nasional Fase 7 (migrasi 080). Jalankan di SQL editor Supabase
-- SETELAH migrasi 080. Semua perubahan di-rollback; gagal = exception
-- "GAGAL: ...", sukses = notice "SEMUA LOLOS".
--
-- Menjadikan satu SKP Disetujui nyata sebagai induk nasional, lalu menguji
-- batas klaim (tidak pernah memblokir), penutupan (menolak klaim baru, klaim
-- berjalan tetap diproses), selesai otomatis, dan buka kembali. Dilewati
-- dengan notice bila tidak ada SKP / akun yang cocok.

begin;

do $$
begin
  if to_regprocedure('public.complete_closed_national_parent()') is null
     or to_regprocedure('public.campaigns_guard_national_close()') is null then
    raise exception 'GAGAL: migrasi 080_national_close.sql belum dijalankan — jalankan migrasi itu dulu, baru tes ini';
  end if;
end
$$;

do $$
declare
  v_parent   uuid;
  v_plain    uuid;
  v_national uuid := (select id from public.regions where lower(trim(name)) = 'national' limit 1);
  u1         public.users;
  u2         public.users;
  p          public.campaigns;
  v_k1       uuid;
  v_k2       uuid;
  v_k3       uuid;
  v_caught   boolean;
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

  select c.id into v_plain
    from public.campaigns c
   where not c.is_national and c.parent_campaign_id is null and c.id is distinct from v_parent
   limit 1;

  select * into u1 from public.users
   where role = 'distributor' and is_active and distributor_id is not null
   order by id limit 1;
  select * into u2 from public.users
   where role = 'distributor' and is_active and distributor_id is not null and id <> u1.id
   order by id limit 1;

  if v_parent is null or v_national is null or u1.id is null or u2.id is null then
    raise notice 'DILEWATI: tidak ada SKP Disetujui Sales/TM tanpa aktivitas klaim, region National, atau dua akun distributor aktif berperusahaan untuk diuji';
    return;
  end if;

  -- 0. kolom Fase 7 tidak berlaku pada SKP yang bukan induk nasional
  if v_plain is not null then
    update public.campaigns
       set claim_deadline = current_date, national_closed_at = now()
     where id = v_plain;
    select * into p from public.campaigns where id = v_plain;
    if p.claim_deadline is not null or p.national_closed_at is not null then
      raise exception 'GAGAL: batas klaim / penutupan tidak boleh tersimpan pada SKP yang bukan induk nasional';
    end if;
  end if;

  update public.campaigns
     set is_national = true, distributor_id = null, region_id = v_national,
         skp_number = coalesce(skp_number, 'TES-080')
   where id = v_parent;

  -- 1. batas klaim yang sudah lewat tidak menolak pembuatan klaim
  update public.campaigns set claim_deadline = current_date - 30 where id = v_parent;
  select * into p from public.campaigns where id = v_parent;
  if p.claim_deadline is distinct from current_date - 30 then
    raise exception 'GAGAL: batas klaim harus tersimpan pada induk nasional';
  end if;
  v_k1 := public.create_national_child_claim(v_parent, u1.id);
  if v_k1 is null then raise exception 'GAGAL: batas klaim terlewat tidak boleh menolak pembuatan klaim'; end if;

  -- 2. induk yang belum ditutup tidak pernah Selesai otomatis
  perform public.cancel_national_child_claim(v_k1, u1.id);
  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'approved' then
    raise exception 'GAGAL: induk yang belum ditutup tidak boleh berubah status saat turunannya dibatalkan (dapat %)', p.status;
  end if;

  -- 3. ditutup tanpa klaim berjalan → langsung Selesai (dibatalkan lagi lewat sub-blok)
  begin
    update public.campaigns set national_closed_at = now() where id = v_parent;
    select * into p from public.campaigns where id = v_parent;
    if p.status <> 'completed' or p.national_closed_at is null then
      raise exception 'GAGAL: induk tanpa klaim berjalan harus langsung Selesai saat ditutup (dapat %)', p.status;
    end if;

    -- induk Selesai tidak bisa dibuka kembali
    v_caught := false;
    begin
      update public.campaigns set national_closed_at = null where id = v_parent;
    exception when check_violation then v_caught := true;
    end;
    if not v_caught then raise exception 'GAGAL: induk yang sudah Selesai tidak boleh dibuka kembali'; end if;

    raise exception 'urungkan sub-blok' using errcode = 'ZZ080';
  exception when sqlstate 'ZZ080' then null;
  end;

  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'approved' or p.national_closed_at is not null then
    raise exception 'GAGAL: prasyarat — sub-blok langkah 3 harus terurungkan';
  end if;

  -- 4. ditutup saat masih ada klaim berjalan → tetap Disetujui, klaim baru ditolak
  v_k2 := public.create_national_child_claim(v_parent, u1.id);
  v_k3 := public.create_national_child_claim(v_parent, u2.id);
  update public.campaigns set national_closed_at = now() where id = v_parent;
  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'approved' or p.national_closed_at is null then
    raise exception 'GAGAL: induk dengan klaim berjalan harus tetap Disetujui setelah ditutup (dapat %)', p.status;
  end if;

  update public.campaigns set status = 'cancelled' where id = v_k2;  -- u1 tidak punya klaim terbuka lagi
  v_caught := false;
  begin
    perform public.create_national_child_claim(v_parent, u1.id);
  exception when raise_exception then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk yang sudah ditutup harus menolak klaim turunan baru'; end if;

  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'approved' then
    raise exception 'GAGAL: induk tertutup tidak boleh Selesai selama masih ada klaim berjalan (dapat %)', p.status;
  end if;

  -- 5. buka kembali: klaim baru boleh lagi; tutup lagi
  update public.campaigns set national_closed_at = null where id = v_parent;
  select * into p from public.campaigns where id = v_parent;
  if p.national_closed_at is not null or p.national_closed_by is not null then
    raise exception 'GAGAL: buka kembali harus mengosongkan waktu dan pelaku penutupan';
  end if;
  v_k2 := public.create_national_child_claim(v_parent, u1.id);
  if v_k2 is null then raise exception 'GAGAL: induk yang dibuka kembali harus menerima klaim baru'; end if;
  update public.campaigns set national_closed_at = now() where id = v_parent;

  -- 6. klaim berjalan tetap diproses sampai Selesai; induk ikut Selesai di klaim terakhir
  update public.campaigns set status = 'completed' where id = v_k2;
  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'approved' then
    raise exception 'GAGAL: induk tertutup belum boleh Selesai — masih ada satu klaim berjalan (dapat %)', p.status;
  end if;

  update public.campaigns set status = 'completed' where id = v_k3;
  select * into p from public.campaigns where id = v_parent;
  if p.status <> 'completed' then
    raise exception 'GAGAL: induk tertutup harus Selesai saat klaim turunan terakhir Selesai (dapat %)', p.status;
  end if;

  -- 7. induk Selesai tidak bisa dibuka kembali
  v_caught := false;
  begin
    update public.campaigns set national_closed_at = null where id = v_parent;
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'GAGAL: induk yang sudah Selesai tidak boleh dibuka kembali'; end if;

  raise notice 'LOLOS: batas klaim, tutup, selesai otomatis, dan buka kembali sesuai PRD';
end
$$;

do $$ begin raise notice 'SEMUA LOLOS: SKP Nasional Fase 7 (080)'; end $$;

rollback;

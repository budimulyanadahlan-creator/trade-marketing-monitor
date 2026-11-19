-- 080: SKP Nasional — Fase 7 (plans/plan-skp-nasional.md)
-- Batas klaim, tutup, dan selesai otomatis.
--
-- Isi:
--   1. Kolom campaigns.claim_deadline (batas klaim — pengingat, tidak pernah
--      memblokir), national_closed_at, national_closed_by (waktu dan pelaku
--      penutupan) + constraint: hanya ada pada SKP induk nasional.
--   2. Trigger campaigns_guard_national_close (BEFORE INSERT/UPDATE):
--        - ketiga kolom dikosongkan pada baris yang bukan induk nasional
--          (mis. saat tanda nasional dicabut);
--        - hanya admin/superadmin (atau hak layanan / SQL editor) yang boleh
--          mengubahnya;
--        - menutup: hanya induk berstatus Disetujui; waktu = now(), pelaku =
--          akun yang login; bila tidak ada klaim turunan yang masih berjalan,
--          induk langsung berstatus Selesai;
--        - membuka kembali: ditolak bila induk sudah Selesai.
--   3. Trigger campaigns_complete_closed_national_parent (AFTER UPDATE OF
--      status pada klaim turunan): saat sebuah turunan menjadi Selesai atau
--      Dibatalkan, induknya yang sudah ditutup menjadi Selesai bila tidak ada
--      turunan lain yang masih berjalan. Induk dikunci dulu agar dua turunan
--      yang diselesaikan bersamaan tidak saling melewatkan. Induk yang belum
--      ditutup tidak pernah disentuh.
--   4. create_national_child_claim: induk yang sudah ditutup menolak klaim
--      turunan baru. (Aturan lain sama dengan 075.) Batas klaim tidak
--      diperiksa di mana pun.
--
-- Padanan sisi aplikasi: lib/national-skp.ts (claimDeadlineError,
-- closeNationalError, reopenNationalError, nationalAutoCompleteDue,
-- createChildClaimError).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 7: aplikasi memilih dan menulis
-- ketiga kolom baru. Aman untuk aplikasi lama: kolom baru kosong, belum ada
-- induk yang ditutup, jadi semua aturan lama berlaku persis seperti
-- sebelumnya.
-- Prasyarat: migrasi 074–079 sudah dijalankan.

-- ============================================================
-- 1. KOLOM + BENTUK
-- ============================================================

alter table public.campaigns
  add column if not exists claim_deadline     date,
  add column if not exists national_closed_at timestamptz,
  add column if not exists national_closed_by uuid references public.users(id);

comment on column public.campaigns.claim_deadline is
  'Batas klaim SKP induk nasional (080): pengingat untuk distributor dan Finance, tidak pernah menolak klaim.';
comment on column public.campaigns.national_closed_at is
  'Waktu SKP induk nasional ditutup admin (080): tidak menerima klaim turunan baru. NULL = masih terbuka.';
comment on column public.campaigns.national_closed_by is
  'Akun yang menutup SKP induk nasional (080).';

alter table public.campaigns
  drop constraint if exists campaigns_national_close_shape;

alter table public.campaigns
  add constraint campaigns_national_close_shape
  check (
    (
      is_national
      or (claim_deadline is null and national_closed_at is null and national_closed_by is null)
    )
    and (national_closed_by is null or national_closed_at is not null)
  );

-- ============================================================
-- 2. TRIGGER campaigns: batas klaim, tutup, buka kembali
-- ============================================================

create or replace function public.campaigns_guard_national_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_changed boolean;
begin
  -- Bukan induk nasional (SKP biasa, klaim turunan, atau tanda nasional baru
  -- saja dicabut): kolom Fase 7 tidak berlaku.
  if not new.is_national then
    new.claim_deadline     := null;
    new.national_closed_at := null;
    new.national_closed_by := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.national_closed_at is not null or new.national_closed_by is not null then
      raise exception 'SKP Nasional tidak dapat dibuat dalam keadaan sudah ditutup'
        using errcode = '23514';
    end if;
    v_changed := new.claim_deadline is not null;
  else
    v_changed := new.claim_deadline is distinct from old.claim_deadline
              or new.national_closed_at is distinct from old.national_closed_at
              or new.national_closed_by is distinct from old.national_closed_by;
  end if;

  if not v_changed then
    return new;
  end if;

  -- auth.uid() kosong = hak layanan / SQL editor → diizinkan.
  if v_uid is not null and not exists (
    select 1 from public.users u
     where u.id = v_uid
       and u.role in ('admin', 'superadmin')
       and u.is_active = true
  ) then
    raise exception 'Hanya admin yang dapat mengubah batas klaim atau menutup SKP Nasional'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.national_closed_at is null and new.national_closed_at is not null then
    -- MENUTUP
    if old.status <> 'approved' or new.status <> 'approved' then
      raise exception 'Hanya SKP Nasional berstatus Disetujui yang dapat ditutup'
        using errcode = '23514';
    end if;

    new.national_closed_at := now();
    new.national_closed_by := coalesce(v_uid, new.national_closed_by);

    -- Tidak ada klaim turunan yang masih berjalan → langsung Selesai.
    if not exists (
      select 1 from public.campaigns k
       where k.parent_campaign_id = new.id
         and k.status not in ('completed', 'cancelled')
    ) then
      new.status := 'completed';
    end if;

  elsif old.national_closed_at is not null and new.national_closed_at is null then
    -- MEMBUKA KEMBALI
    if old.status = 'completed' then
      raise exception 'SKP Nasional yang sudah Selesai tidak dapat dibuka kembali'
        using errcode = '23514';
    end if;
    new.national_closed_by := null;

  elsif old.national_closed_at is not null then
    -- Masih tertutup: waktu dan pelaku penutupan tidak diubah.
    new.national_closed_at := old.national_closed_at;
    new.national_closed_by := old.national_closed_by;

  else
    -- Masih terbuka: tidak ada pelaku penutupan.
    new.national_closed_by := null;
  end if;

  return new;
end;
$$;

comment on function public.campaigns_guard_national_close() is
  'Menjaga batas klaim dan penutupan SKP induk nasional: hanya admin, hanya induk Disetujui, langsung Selesai bila tidak ada klaim turunan berjalan, tidak bisa dibuka kembali setelah Selesai. (080)';

drop trigger if exists campaigns_guard_national_close on public.campaigns;
create trigger campaigns_guard_national_close
  before insert or update on public.campaigns
  for each row execute function public.campaigns_guard_national_close();

-- ============================================================
-- 3. TRIGGER: induk tertutup → Selesai saat turunan terakhir beres
-- ============================================================

create or replace function public.complete_closed_national_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Kunci induk dulu, baru periksa turunan di pernyataan berikutnya:
  -- transaksi yang antre di sini melihat status turunan lain yang baru saja
  -- di-commit.
  perform 1 from public.campaigns where id = new.parent_campaign_id for update;

  update public.campaigns p
     set status = 'completed'
   where p.id = new.parent_campaign_id
     and p.is_national
     and p.national_closed_at is not null
     and p.status = 'approved'
     and not exists (
       select 1 from public.campaigns k
        where k.parent_campaign_id = p.id
          and k.status not in ('completed', 'cancelled')
     );

  return null;
end;
$$;

comment on function public.complete_closed_national_parent() is
  'SKP induk nasional yang sudah ditutup menjadi Selesai saat klaim turunan terakhirnya Selesai atau Dibatalkan. (080)';

drop trigger if exists campaigns_complete_closed_national_parent on public.campaigns;
create trigger campaigns_complete_closed_national_parent
  after update of status on public.campaigns
  for each row
  when (new.parent_campaign_id is not null
        and new.status is distinct from old.status
        and new.status in ('completed', 'cancelled'))
  execute function public.complete_closed_national_parent();

-- ============================================================
-- 4. BUAT KLAIM TURUNAN: induk tertutup menolak klaim baru
-- (aturan lain sama dengan 075)
-- ============================================================

create or replace function public.create_national_child_claim(
  p_parent_id uuid,
  p_owner_id  uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent   public.campaigns;
  v_owner    public.users;
  v_seq      integer;
  v_owner_no integer;
  v_id       uuid;
begin
  -- Kunci baris induk: dua akun yang menekan "Buat Klaim" bersamaan
  -- diantrekan di sini sehingga nomor urutnya berbeda; penutupan oleh admin
  -- (UPDATE baris yang sama) juga antre di sini.
  select * into v_parent
    from public.campaigns
   where id = p_parent_id
     for update;

  if not found then
    raise exception 'SKP tidak ditemukan' using errcode = 'P0001';
  end if;
  if not v_parent.is_national or v_parent.parent_campaign_id is not null then
    raise exception 'SKP ini bukan SKP Nasional' using errcode = 'P0001';
  end if;
  -- Ditutup (080). Batas klaim sengaja tidak diperiksa: hanya pengingat.
  if v_parent.national_closed_at is not null then
    raise exception 'SKP Nasional ini sudah ditutup — klaim baru tidak dapat dibuat' using errcode = 'P0001';
  end if;
  if v_parent.status <> 'approved' then
    raise exception 'Klaim hanya dapat dibuat pada SKP Nasional berstatus Disetujui' using errcode = 'P0001';
  end if;
  if v_parent.skp_number is null then
    raise exception 'SKP Nasional ini belum bernomor — hubungi admin Marmot' using errcode = 'P0001';
  end if;

  select * into v_owner from public.users where id = p_owner_id;

  if not found or v_owner.role::text <> 'distributor' then
    raise exception 'Hanya akun distributor yang dapat membuat klaim atas SKP Nasional' using errcode = 'P0001';
  end if;
  if not v_owner.is_active then
    raise exception 'Akun tidak aktif' using errcode = 'P0001';
  end if;
  if v_owner.distributor_id is null then
    raise exception 'Akun Anda belum terhubung ke perusahaan distributor' using errcode = 'P0001';
  end if;

  -- Satu klaim yang belum diajukan per akun per induk.
  if exists (
    select 1 from public.campaigns k
     where k.parent_campaign_id = p_parent_id
       and k.claim_owner_id = p_owner_id
       and k.status in ('approved', 'ongoing')
  ) then
    raise exception 'Selesaikan atau batalkan klaim Anda yang belum diajukan sebelum membuat klaim baru'
      using errcode = 'P0001';
  end if;

  select coalesce(max(k.child_seq), 0) + 1 into v_seq
    from public.campaigns k
   where k.parent_campaign_id = p_parent_id;

  select count(*) + 1 into v_owner_no
    from public.campaigns k
   where k.parent_campaign_id = p_parent_id
     and k.claim_owner_id = p_owner_id;

  insert into public.campaigns (
    name,
    department_id, brand_id, channel_id, promotion_category_id, action_approval_id,
    start_date, end_date, objective, mechanism,
    distributor_id, region_id,
    requested_budget, status, created_by, submitted_at,
    skp_number, parent_campaign_id, claim_owner_id, child_seq
  ) values (
    v_parent.name || ' – klaim ' || coalesce(nullif(trim(v_owner.full_name), ''), 'akun distributor')
      || case when v_owner_no > 1 then ' (' || v_owner_no || ')' else '' end,
    v_parent.department_id, v_parent.brand_id, v_parent.channel_id,
    v_parent.promotion_category_id, v_parent.action_approval_id,
    v_parent.start_date, v_parent.end_date, v_parent.objective, v_parent.mechanism,
    v_owner.distributor_id,
    -- akun tanpa region (mis. pusat) memakai region induk = National
    coalesce(v_owner.region_id, v_parent.region_id),
    0, 'approved', p_owner_id, now(),
    v_parent.skp_number || '-K' || lpad(v_seq::text, 2, '0'),
    p_parent_id, p_owner_id, v_seq
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_national_child_claim(uuid, uuid) is
  'Membuat klaim turunan SKP nasional untuk satu akun distributor; nomor urut per induk dialokasikan atomik; induk yang sudah ditutup menolak. Hanya service_role. (075, 080)';

revoke all on function public.create_national_child_claim(uuid, uuid) from public;
revoke all on function public.create_national_child_claim(uuid, uuid) from anon, authenticated;
grant execute on function public.create_national_child_claim(uuid, uuid) to service_role;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/080_national_close.sql              -- harus "SEMUA LOLOS"
-- \i supabase/tests/078_national_parent_actual_spent.sql -- aturan lama tetap lolos
-- \i supabase/tests/076_national_child_cancel.sql
-- \i supabase/tests/075_national_child_claims.sql
--
-- select count(*) from public.campaigns
--  where claim_deadline is not null or national_closed_at is not null;
-- -- diharapkan 0 sampai admin mengisi batas klaim / menutup SKP Nasional.

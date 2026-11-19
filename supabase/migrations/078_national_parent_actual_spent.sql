-- 078: SKP Nasional — Fase 5 (plans/plan-skp-nasional.md)
-- Pantauan budget di SKP induk: realisasi tiap klaim turunan otomatis
-- terjumlah ke SKP induknya.
--
-- Isi:
--   1. sync_national_parent_actual_spent(): setiap kali actual_spent sebuah
--      klaim turunan berubah (realisasi ditambah, diubah, atau dihapus — lewat
--      trigger sync_campaign_actual_spent dari migrasi 012) atau baris turunan
--      dihapus, actual_spent induk dihitung ulang = jumlah actual_spent semua
--      turunannya. Baris induk dikunci dulu agar dua realisasi pada dua
--      turunan berbeda yang dicatat bersamaan tidak saling menimpa.
--   2. Backfill: actual_spent induk yang sudah punya turunan disamakan.
--
-- Induk sendiri tidak pernah punya realisasi (ditolak sejak 074), jadi
-- actual_spent induk hanya berasal dari turunannya.
--
-- Padanan sisi aplikasi: lib/national-skp.ts (nationalBudgetSummary).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 5: halaman induk menampilkan
-- Total Realisasi dari kolom ini. Aman untuk aplikasi lama: hanya mengisi
-- kolom actual_spent induk yang sebelumnya selalu 0.
-- Prasyarat: migrasi 074–077 sudah dijalankan.

-- ============================================================
-- 1. TRIGGER: actual_spent induk = jumlah actual_spent turunannya
-- ============================================================

create or replace function public.sync_national_parent_actual_spent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid;
begin
  if tg_op = 'DELETE' then
    v_parent_id := old.parent_campaign_id;
  else
    v_parent_id := new.parent_campaign_id;
  end if;

  if v_parent_id is null then
    return null;
  end if;

  -- Kunci induk dulu, baru jumlahkan di pernyataan berikutnya: transaksi yang
  -- antre di sini melihat actual_spent turunan lain yang baru saja di-commit.
  perform 1 from public.campaigns where id = v_parent_id for update;

  update public.campaigns p
     set actual_spent = (
       select coalesce(sum(k.actual_spent), 0)
         from public.campaigns k
        where k.parent_campaign_id = v_parent_id
     )
   where p.id = v_parent_id;

  return null;
end;
$$;

comment on function public.sync_national_parent_actual_spent() is
  'Menjaga campaigns.actual_spent SKP induk nasional = jumlah actual_spent klaim turunannya. (078)';

drop trigger if exists campaigns_sync_national_parent_spent on public.campaigns;
create trigger campaigns_sync_national_parent_spent
  after update of actual_spent on public.campaigns
  for each row
  when (new.parent_campaign_id is not null
        and new.actual_spent is distinct from old.actual_spent)
  execute function public.sync_national_parent_actual_spent();

drop trigger if exists campaigns_sync_national_parent_spent_del on public.campaigns;
create trigger campaigns_sync_national_parent_spent_del
  after delete on public.campaigns
  for each row
  when (old.parent_campaign_id is not null)
  execute function public.sync_national_parent_actual_spent();

-- ============================================================
-- 2. BACKFILL
-- ============================================================

update public.campaigns p
   set actual_spent = t.total
  from (
    select k.parent_campaign_id, coalesce(sum(k.actual_spent), 0) as total
      from public.campaigns k
     where k.parent_campaign_id is not null
     group by k.parent_campaign_id
  ) t
 where p.id = t.parent_campaign_id
   and p.actual_spent is distinct from t.total;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/078_national_parent_actual_spent.sql -- harus "SEMUA LOLOS"
-- \i supabase/tests/077_national_child_pusat_view.sql    -- aturan lama tetap lolos
-- \i supabase/tests/076_national_child_cancel.sql
--
-- select p.skp_number, p.actual_spent,
--        (select coalesce(sum(k.actual_spent), 0) from public.campaigns k
--          where k.parent_campaign_id = p.id) as jumlah_turunan
--   from public.campaigns p
--  where p.is_national;
-- -- actual_spent harus sama dengan jumlah_turunan di setiap baris.

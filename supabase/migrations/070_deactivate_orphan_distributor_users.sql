-- 070: Multi-User Distributor — Fase 7 (plans/plan-multi-user-distributor.md)
-- Nonaktifkan 5 akun distributor lama yang tidak terhubung ke perusahaan mana pun.
--
-- Akun (diverifikasi di production 2026-11-02, tidak ada aktivitas klaim —
-- claim_submitted_by / campaign_files / distributor_receipts / claim_events = 0):
--   Finance Distributor  finance@dima.com
--   Finance-dima         financedima@dima.com
--   distributor-tes      distributor-tes@gmail.com
--   Kemal                distributor2@dima.co.id
--   Meriana (duplikat)   meriana@dima.co.id  — Meriana yang resmi sudah punya
--                        akun lain yang terhubung ke perusahaan
--
-- Setelah itu constraint users_distributor_fields_check (migrasi 065, dibuat
-- NOT VALID) divalidasi: semua akun distributor aktif kini wajib punya
-- perusahaan + cakupan (+ region untuk Cabang). Mengaktifkan kembali akun
-- tanpa perusahaan sudah ditolak di aplikasi (Fase 2) dan kini juga oleh
-- constraint ini.

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.users
  where role = 'distributor'
    and distributor_id is null
    and is_active = true;

  -- Pengaman: migrasi ini ditulis untuk persis 5 akun. Kalau jumlahnya lain,
  -- berhenti dan periksa dulu (mungkin ada akun baru yang salah input).
  if v_count <> 5 then
    raise exception
      'Ditemukan % akun distributor aktif tanpa perusahaan (diharapkan 5) — periksa dulu sebelum menonaktifkan',
      v_count;
  end if;

  update public.users
  set is_active = false
  where role = 'distributor'
    and distributor_id is null
    and is_active = true;
end
$$;

alter table public.users validate constraint users_distributor_fields_check;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- select full_name, is_active from public.users
--   where role = 'distributor' and distributor_id is null order by full_name;
-- -- diharapkan: 5 baris, semua is_active = false
-- select convalidated from pg_constraint where conname = 'users_distributor_fields_check';
-- -- diharapkan: true

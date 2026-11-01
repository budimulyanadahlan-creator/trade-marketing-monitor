-- 068: Multi-User Distributor — Fase 4 (plans/plan-multi-user-distributor.md)
-- Wajib ganti password di login pertama.
--
-- 1. users.must_change_password boolean not null default false.
--    Dinyalakan aplikasi saat admin membuat user / me-reset password, dan
--    dimatikan setelah user mengganti password sendiri di /ganti-password.
-- 2. Trigger: user biasa tidak boleh mematikan flag-nya sendiri lewat policy
--    users_update_self (hanya admin/superadmin atau service role).
-- 3. Data: nyalakan flag untuk 25 akun cabang EDM/MMS/BIR yang dibuat
--    2026-10-30 lewat skrip massal (password sementara dibagikan via WA/Excel).

-- ============================================================
-- 1. KOLOM
-- ============================================================

alter table public.users
  add column if not exists must_change_password boolean not null default false;

-- ============================================================
-- 2. PENGAMAN: flag hanya boleh diubah admin / service role
-- ============================================================

create or replace function public.users_guard_must_change_password()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.must_change_password is distinct from old.must_change_password
     and auth.uid() is not null
     and not exists (
       select 1 from public.users a
       where a.id = auth.uid()
         and a.role in ('admin', 'superadmin')
         and a.is_active = true
     )
  then
    raise exception 'FLAG_GANTI_PASSWORD: hanya admin yang boleh mengubah status wajib ganti password';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_must_change_password on public.users;
create trigger users_guard_must_change_password
  before update of must_change_password on public.users
  for each row execute function public.users_guard_must_change_password();

-- ============================================================
-- 3. DATA: 25 akun cabang yang dibuat 2026-10-30
-- ============================================================

update public.users u
set must_change_password = true
from public.distributors d
where u.distributor_id = d.id
  and u.role = 'distributor'
  and u.distributor_scope = 'cabang'
  and u.is_active = true
  and (u.created_at at time zone 'Asia/Jakarta')::date = date '2026-10-30'
  and lower(d.name) in (
    lower('Esham Dima'),
    lower('Mitra Monas Sejahtera'),
    lower('Bintang Indo Raya')
  );

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- select d.name, count(*) from public.users u
--   join public.distributors d on d.id = u.distributor_id
--   where u.must_change_password group by 1 order by 1;
-- -- diharapkan: Bintang Indo Raya 1, Esham Dima 16, Mitra Monas Sejahtera 8 (total 25)

-- 029: Kolom distributor_id di users
-- Link akun user ber-role distributor ke perusahaan distributornya.
-- Nullable, FK ke distributors, on delete set null — fondasi saja, belum dipakai di RLS mana pun.

alter table public.users
  add column if not exists distributor_id uuid
  references public.distributors (id) on delete set null;

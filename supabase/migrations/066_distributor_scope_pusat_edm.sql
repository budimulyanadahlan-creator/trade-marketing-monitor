-- 066: Multi-User Distributor — koreksi data Fase 2
-- Migrasi 065 menandai akun pusat EDM lewat departemen finance/controller
-- (asumsi PRD). Di production, 4 akun kantor pusat Esham Dima (Meriana, lenny,
-- vellan, controller; dibuat 2026-08-01) ternyata berdepartemen Sales dengan
-- region "National", sehingga ikut menjadi cabang. Dikonfirmasi user 2026-11-02:
-- akun EDM dengan region National = Pusat.

update public.users u
set distributor_scope = 'pusat'
from public.distributors d, public.regions r
where u.distributor_id = d.id
  and u.region_id = r.id
  and u.role = 'distributor'
  and lower(d.name) = lower('Esham Dima')
  and lower(r.name) = 'national'
  and u.distributor_scope is distinct from 'pusat';

-- Verifikasi:
-- select u.full_name, u.distributor_scope from public.users u
--   join public.distributors d on d.id = u.distributor_id
--   where u.role = 'distributor' and lower(d.name) = 'esham dima' and u.distributor_scope = 'pusat';
-- -- diharapkan 4 baris: Meriana, lenny, vellan, controller

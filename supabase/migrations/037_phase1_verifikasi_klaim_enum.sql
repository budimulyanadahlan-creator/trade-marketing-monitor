-- Phase 1 (Verifikasi Klaim oleh Finance): dua status baru pada alur klaim.
-- ongoing → claim_submitted → claim_verified → ready_to_pay → paid → completed
--
-- HANYA enum di file ini. Kebijakan RLS yang memakai nilai baru ada di
-- migration 038 — Postgres menolak penggunaan nilai enum baru di dalam
-- transaksi yang sama dengan ADD VALUE ("unsafe use of new value of enum
-- type"), jadi kedua file HARUS dijalankan sebagai dua eksekusi terpisah.

do $$ begin
  alter type public.campaign_status add value if not exists 'claim_verified' after 'claim_submitted';
exception when others then null;
end $$;

do $$ begin
  alter type public.campaign_status add value if not exists 'ready_to_pay' after 'claim_verified';
exception when others then null;
end $$;

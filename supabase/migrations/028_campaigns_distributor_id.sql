-- 028: Kolom distributor_id di campaigns
-- SKP bisa mencatat distributor (perusahaan penyalur) terpisah dari vendor.
-- Nullable, FK ke distributors, on delete set null — sejajar perilaku vendor_id.

alter table public.campaigns
  add column if not exists distributor_id uuid
  references public.distributors (id) on delete set null;

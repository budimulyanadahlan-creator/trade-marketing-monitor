-- Bulk historical import (TP1 Q2 Trade Promo): reference_number column.
--
-- Stores the SKP letter number ("No Surat", e.g. "222 RAF-KAM/VII/2026")
-- for campaigns entered in bulk from historical, already-approved SKP
-- recaps. Nullable + unique so normal UI-created campaigns (which don't
-- have a physical SKP number) are unaffected, while bulk-imported rows
-- can be deduplicated safely if the import script is ever re-run.

alter table public.campaigns
  add column if not exists reference_number text;

create unique index if not exists campaigns_reference_number_unique
  on public.campaigns (reference_number)
  where reference_number is not null;

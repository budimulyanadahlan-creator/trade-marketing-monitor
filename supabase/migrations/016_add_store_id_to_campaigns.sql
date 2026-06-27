-- Add optional store_id field to campaigns.
-- Shown in SKP form Step 2 when promotion category account_code is TP1, TP3, or TP4.

ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS store_id TEXT DEFAULT NULL;

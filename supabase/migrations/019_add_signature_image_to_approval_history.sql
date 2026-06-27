-- Add digital signature image (base64 data URL) to approval_history
ALTER TABLE public.approval_history
  ADD COLUMN IF NOT EXISTS signature_image TEXT;

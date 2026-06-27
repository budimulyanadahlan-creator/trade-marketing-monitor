-- Phase 5: Tracking & Realisasi
-- actual_spent (bigint, default 0) already exists on campaigns table from Phase 3.
-- Realtime (REPLICA IDENTITY FULL + supabase_realtime publication) already enabled from Phase 4.
-- This migration adds a non-negative constraint on actual_spent.

alter table public.campaigns
  add constraint campaigns_actual_spent_non_negative
  check (actual_spent >= 0);

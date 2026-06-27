-- Phase 4: Multi-level approval statuses
-- Adds approved_l2, approved_l3, approved_l4 to support 5-level approval chain

ALTER TYPE public.campaign_status ADD VALUE IF NOT EXISTS 'approved_l2';
ALTER TYPE public.campaign_status ADD VALUE IF NOT EXISTS 'approved_l3';
ALTER TYPE public.campaign_status ADD VALUE IF NOT EXISTS 'approved_l4';

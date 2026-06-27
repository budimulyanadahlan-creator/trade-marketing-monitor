-- PRD v2: Add distributor role + region_id to users
-- Distributor: external partner who can view/checklist fully-approved SKPs from their region.
-- region_id: nullable for non-Sales/non-Distributor users.

-- 1. Extend the user_role enum with 'distributor'
alter type public.user_role add value if not exists 'distributor';

-- 2. Add region_id column to users (nullable — only required for Sales Dept users and Distributors)
alter table public.users
  add column if not exists region_id uuid references public.regions(id) on delete set null;

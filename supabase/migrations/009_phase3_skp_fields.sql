-- Phase 3 (PRD v2): Add mechanism, sales_projection to campaigns
-- Also extend campaign_status enum with claim_submitted and paid
-- for the full tracking flow defined in PRD v2.

-- ============================================================
-- 1. EXTEND campaign_status ENUM
-- ============================================================

-- Postgres requires ADD VALUE outside a transaction block.
-- Using DO $$ pattern for idempotency.
do $$ begin
  alter type public.campaign_status add value if not exists 'claim_submitted' after 'ongoing';
exception when others then null;
end $$;

do $$ begin
  alter type public.campaign_status add value if not exists 'paid' after 'claim_submitted';
exception when others then null;
end $$;

-- ============================================================
-- 2. ADD COLUMNS TO campaigns
-- ============================================================

-- mechanism: wajib diisi di Step 2. Defaulting to '' for existing rows.
alter table public.campaigns
  add column if not exists mechanism text not null default '';

-- sales_projection: diisi di Step 3, digunakan untuk menghitung cost_ratio.
alter table public.campaigns
  add column if not exists sales_projection bigint not null default 0;

-- Phase 4 (Bukti Eksekusi & Klaim Online): Tandai Dibayar.
--
-- Columns markAsPaidAction needs to record when/how a claim was paid:
-- an optional payment date (defaults to the action's timestamp when
-- omitted) and an optional free-text note from finance/admin.
--
-- No RLS change needed here: the existing "campaigns_update" policy
-- (migration 004) already grants UPDATE to finance/admin/superadmin
-- regardless of the row's current status, and markAsPaidAction is
-- extending its allowed roles to include "admin" (previously
-- finance/superadmin only) at the application layer only.

alter table public.campaigns
  add column if not exists paid_at timestamptz,
  add column if not exists paid_note text;

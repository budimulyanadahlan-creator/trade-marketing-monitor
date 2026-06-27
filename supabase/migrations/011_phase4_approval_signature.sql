-- Phase 4 fix: signature_text evidence + expanded action constraint
-- Per PRD v2 US 22: approver must fill signature_text (full name) + comment when approving

-- 1. Add signature_text column for formal approval evidence
ALTER TABLE public.approval_history
  ADD COLUMN IF NOT EXISTS signature_text TEXT;

-- 2. Fix action check constraint to include all multi-level statuses
--    The original constraint only allowed submitted/approved_l1/approved/rejected,
--    which would reject inserts for approved_l2..approved_l4 in a 3-5 level workflow.
ALTER TABLE public.approval_history
  DROP CONSTRAINT IF EXISTS approval_history_action_check;

ALTER TABLE public.approval_history
  ADD CONSTRAINT approval_history_action_check
  CHECK (action IN (
    'submitted',
    'approved_l1',
    'approved_l2',
    'approved_l3',
    'approved_l4',
    'approved',
    'rejected'
  ));

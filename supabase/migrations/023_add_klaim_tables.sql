-- Phase 1: SKP Klaim Enhancement — Database Foundation
-- Creates 3 new tables: claim_document_types, claim_requirements, distributor_claim_checklists

-- -------------------------------------------------------
-- claim_document_types: master list of 15 claim document types
-- -------------------------------------------------------
CREATE TABLE public.claim_document_types (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  sort_order INT         NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.claim_document_types ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read document types
CREATE POLICY "claim_document_types_select"
  ON public.claim_document_types FOR SELECT TO authenticated
  USING (true);

-- Only admin/superadmin can manage document types
CREATE POLICY "claim_document_types_insert"
  ON public.claim_document_types FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin')
        AND u.is_active = true
    )
  );

CREATE POLICY "claim_document_types_update"
  ON public.claim_document_types FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin')
        AND u.is_active = true
    )
  );

CREATE POLICY "claim_document_types_delete"
  ON public.claim_document_types FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin')
        AND u.is_active = true
    )
  );

-- Seed 15 document types
INSERT INTO public.claim_document_types (name, sort_order) VALUES
  ('SKP Number',                   1),
  ('ASM Sign',                     2),
  ('Invoice',                      3),
  ('VAT Document',                 4),
  ('WHT 23',                       5),
  ('WHT Final 4(2)',               6),
  ('Recap Sell In Distributor',    7),
  ('Recap Sell Out Distributor',   8),
  ('Recap Sell Out Outlet',        9),
  ('Delivery Note',               10),
  ('Kwitansi Outlet',             11),
  ('Transfer Slip',               12),
  ('ID Card & Phone No',          13),
  ('Contract Agreement Store',    14),
  ('Foto Timestamp',              15);

-- -------------------------------------------------------
-- claim_requirements: mapping promotion_category → document_type
-- -------------------------------------------------------
CREATE TABLE public.claim_requirements (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_category_id UUID        NOT NULL REFERENCES public.promotion_categories(id) ON DELETE CASCADE,
  document_type_id      UUID        NOT NULL REFERENCES public.claim_document_types(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promotion_category_id, document_type_id)
);

ALTER TABLE public.claim_requirements ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read requirements
CREATE POLICY "claim_requirements_select"
  ON public.claim_requirements FOR SELECT TO authenticated
  USING (true);

-- Only admin/superadmin can manage requirements
CREATE POLICY "claim_requirements_insert"
  ON public.claim_requirements FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin')
        AND u.is_active = true
    )
  );

CREATE POLICY "claim_requirements_delete"
  ON public.claim_requirements FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin')
        AND u.is_active = true
    )
  );

-- -------------------------------------------------------
-- distributor_claim_checklists: distributor self-declaration per campaign per document
-- -------------------------------------------------------
CREATE TABLE public.distributor_claim_checklists (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  distributor_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_type_id UUID        NOT NULL REFERENCES public.claim_document_types(id) ON DELETE CASCADE,
  is_fulfilled     BOOLEAN     NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, distributor_id, document_type_id)
);

ALTER TABLE public.distributor_claim_checklists ENABLE ROW LEVEL SECURITY;

-- Distributor can only see their own checklist entries
CREATE POLICY "distributor_claim_checklists_select_distributor"
  ON public.distributor_claim_checklists FOR SELECT TO authenticated
  USING (
    -- Distributor sees only their own
    (
      distributor_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role = 'distributor'
          AND u.is_active = true
      )
    )
    -- Admin / superadmin / finance / manager see all
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'superadmin', 'finance', 'manager')
        AND u.is_active = true
    )
  );

-- Distributor can only insert for themselves
CREATE POLICY "distributor_claim_checklists_insert"
  ON public.distributor_claim_checklists FOR INSERT TO authenticated
  WITH CHECK (
    distributor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'distributor'
        AND u.is_active = true
    )
  );

-- Distributor can only update their own rows
CREATE POLICY "distributor_claim_checklists_update"
  ON public.distributor_claim_checklists FOR UPDATE TO authenticated
  USING (
    distributor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role = 'distributor'
        AND u.is_active = true
    )
  );

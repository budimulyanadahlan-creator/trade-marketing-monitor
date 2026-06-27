-- Phase 3: Add cost_ratio as a stored generated column.
-- Value = (requested_budget / sales_projection) * 100, rounded to 2 decimal places.
-- NULL when sales_projection = 0 to avoid division by zero.

alter table public.campaigns
  add column if not exists cost_ratio numeric generated always as (
    case
      when sales_projection > 0
        then round((requested_budget::numeric / sales_projection) * 100, 2)
      else null
    end
  ) stored;

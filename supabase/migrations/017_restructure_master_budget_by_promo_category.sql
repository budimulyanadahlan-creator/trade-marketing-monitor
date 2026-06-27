-- Migration 017: Restrukturisasi master_budgets dari per-Departemen → per-Kategori Promosi
-- Sebelum: master_budgets (department_id, fiscal_year, quarter) → budget_allocations (brand + promo_category)
-- Sesudah: master_budgets (promotion_category_id, fiscal_year, quarter) → budget_allocations (brand saja)

-- 1. Bersihkan data lama (struktur berubah incompatible — admin harus input ulang)
TRUNCATE TABLE public.budget_allocations;
TRUNCATE TABLE public.master_budgets;

-- 2. Hapus unique constraint lama di master_budgets
ALTER TABLE public.master_budgets
  DROP CONSTRAINT IF EXISTS master_budgets_dept_year_quarter_unique;

-- 3. Hapus kolom department_id, tambah promotion_category_id
ALTER TABLE public.master_budgets
  DROP COLUMN IF EXISTS department_id;

ALTER TABLE public.master_budgets
  ADD COLUMN promotion_category_id uuid NOT NULL
    REFERENCES public.promotion_categories(id) ON DELETE RESTRICT;

-- 4. Unique constraint baru: satu budget per kategori promosi per quarter per tahun
ALTER TABLE public.master_budgets
  ADD CONSTRAINT master_budgets_promo_cat_year_quarter_unique
  UNIQUE(promotion_category_id, fiscal_year, quarter);

-- 5. Hapus promotion_category_id dari budget_allocations (sudah ada di parent)
ALTER TABLE public.budget_allocations
  DROP CONSTRAINT IF EXISTS budget_allocations_unique;

ALTER TABLE public.budget_allocations
  DROP COLUMN IF EXISTS promotion_category_id;

-- 6. Unique constraint baru di budget_allocations: satu alokasi per brand per master_budget
ALTER TABLE public.budget_allocations
  ADD CONSTRAINT budget_allocations_unique
  UNIQUE(master_budget_id, brand_id);

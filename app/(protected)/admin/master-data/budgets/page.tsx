import { createClient } from "@/lib/supabase/server";
import { BudgetsTable } from "./budgets-table";
import type {
  MasterBudgetRow,
  BudgetAllocationRow,
  BrandRow,
  PromotionCategoryRow,
} from "@/types/database";

type BudgetWithCategory = MasterBudgetRow & {
  promotion_categories: Pick<PromotionCategoryRow, "name" | "account_code"> | null;
};

type AllocationWithRefs = BudgetAllocationRow & {
  brands: Pick<BrandRow, "name"> | null;
};

export default async function BudgetsPage() {
  const supabase = await createClient();

  const [budgetsResult, allocationsResult, categoriesResult, brandsResult] =
    await Promise.all([
      supabase
        .from("master_budgets")
        .select("*, promotion_categories(name, account_code)")
        .order("fiscal_year", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("budget_allocations")
        .select("*, brands(name)")
        .order("created_at"),
      supabase.from("promotion_categories").select("*").order("account_code"),
      supabase.from("brands").select("*").order("name"),
    ]);

  return (
    <BudgetsTable
      budgets={(budgetsResult.data as BudgetWithCategory[]) ?? []}
      allocations={(allocationsResult.data as AllocationWithRefs[]) ?? []}
      categories={categoriesResult.data ?? []}
      brands={brandsResult.data ?? []}
    />
  );
}

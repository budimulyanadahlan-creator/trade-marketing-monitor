import { sumCommittedBudgetByAA } from "@/lib/campaign-status";
import { createClient } from "@/lib/supabase/server";
import { ActionApprovalsTable } from "./action-approvals-table";

export default async function ActionApprovalsPage() {
  const supabase = await createClient();

  const [aaResult, { data: masterBudgets }, { data: brands }, { data: campaignBudgets }] =
    await Promise.all([
      supabase
        .from("action_approvals")
        .select(
          "*, master_budget:master_budgets(id, fiscal_year, quarter, promotion_category:promotion_categories(name)), brand:brands(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("master_budgets")
        .select("id, fiscal_year, quarter, promotion_category:promotion_categories(name)")
        .order("fiscal_year", { ascending: false }),
      supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("campaigns")
        .select("action_approval_id, requested_budget, status")
        .not("action_approval_id", "is", null),
    ]);

  const { data: actionApprovals } = aaResult;

  const budgetByAA = sumCommittedBudgetByAA(campaignBudgets ?? []);

  const actionApprovalsWithBudget = (actionApprovals ?? []).map((aa) => ({
    ...aa,
    budget_tersisa: aa.target_budget - (budgetByAA[aa.id] ?? 0),
  }));

  return (
    <ActionApprovalsTable
      actionApprovals={actionApprovalsWithBudget}
      masterBudgets={masterBudgets ?? []}
      brands={brands ?? []}
    />
  );
}

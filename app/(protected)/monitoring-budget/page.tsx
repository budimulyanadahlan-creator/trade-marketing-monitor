import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import {
  aggregateMonitoringBudget,
  getFiscalPeriod,
  getQuarterDateRange,
  MONITORING_COMMITTED_STATUSES,
  type MonitoringCampaign,
  type MonitoringCategory,
} from "@/lib/monitoring-budget";
import { MonitoringTable } from "./monitoring-table";

const ALLOWED_ROLES: UserRole[] = ["admin", "superadmin"];

export default async function MonitoringBudgetPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/dashboard");
  }

  const { fiscalYear, quarter } = getFiscalPeriod(new Date());
  const { start, endExclusive } = getQuarterDateRange(fiscalYear, quarter);

  const [categoriesResult, budgetsResult, campaignsResult] = await Promise.all([
    supabase
      .from("promotion_categories")
      .select("id, name, type, account_code"),
    supabase
      .from("master_budgets")
      .select("promotion_category_id, total_amount")
      .eq("fiscal_year", fiscalYear)
      .eq("quarter", quarter),
    supabase
      .from("campaigns")
      .select("promotion_category_id, requested_budget, status, start_date")
      .in("status", [...MONITORING_COMMITTED_STATUSES])
      .gte("start_date", start)
      .lt("start_date", endExclusive),
  ]);

  const aggregate = aggregateMonitoringBudget({
    fiscalYear,
    quarter,
    categories: (categoriesResult.data ?? []) as MonitoringCategory[],
    budgets: budgetsResult.data ?? [],
    campaigns: (campaignsResult.data ?? []) as MonitoringCampaign[],
  });

  return <MonitoringTable aggregate={aggregate} />;
}

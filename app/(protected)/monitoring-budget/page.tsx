import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import {
  aggregateMonitoringBudget,
  getFiscalPeriod,
  getQuarterDateRange,
  resolveFiscalPeriod,
  summarizeMissingStartDate,
  MONITORING_COMMITTED_STATUSES,
  type MonitoringCampaign,
  type MonitoringCategory,
} from "@/lib/monitoring-budget";
import { MonitoringTable } from "./monitoring-table";
import { MonitoringPeriodSelector } from "./monitoring-period-selector";

const ALLOWED_ROLES: UserRole[] = ["admin", "superadmin"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function MonitoringBudgetPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
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

  const params = await searchParams;
  const currentFiscalYear = getFiscalPeriod(new Date()).fiscalYear;
  const { fiscalYear, quarter } = resolveFiscalPeriod(
    str(params.fy),
    str(params.q)
  );
  const { start, endExclusive } = getQuarterDateRange(fiscalYear, quarter);

  const [categoriesResult, budgetsResult, campaignsResult, missingStartDateResult] =
    await Promise.all([
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
      supabase
        .from("campaigns")
        .select("status, requested_budget, start_date")
        .in("status", [...MONITORING_COMMITTED_STATUSES])
        .is("start_date", null),
    ]);

  const aggregate = aggregateMonitoringBudget({
    fiscalYear,
    quarter,
    categories: (categoriesResult.data ?? []) as MonitoringCategory[],
    budgets: budgetsResult.data ?? [],
    campaigns: (campaignsResult.data ?? []) as MonitoringCampaign[],
  });

  const missingStartDate = summarizeMissingStartDate(
    missingStartDateResult.data ?? []
  );

  return (
    <MonitoringTable
      aggregate={aggregate}
      missingStartDate={missingStartDate}
      periodSelector={
        <MonitoringPeriodSelector
          fiscalYear={fiscalYear}
          quarter={quarter}
          currentFiscalYear={currentFiscalYear}
        />
      }
    />
  );
}

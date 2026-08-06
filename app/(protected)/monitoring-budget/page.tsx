import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CampaignStatus, UserRole } from "@/types/database";
import {
  aggregateMonitoringBudget,
  aggregateMonitoringBudgetRealisasi,
  getFiscalPeriod,
  getQuarterDateRange,
  resolveFiscalPeriod,
  resolveMonitoringMode,
  summarizeMissingStartDate,
  MONITORING_COMMITTED_STATUSES,
  type MonitoringCampaign,
  type MonitoringCategory,
  type MonitoringRealization,
} from "@/lib/monitoring-budget";
import { MonitoringTable } from "./monitoring-table";
import { MonitoringPeriodSelector } from "./monitoring-period-selector";
import { MonitoringModeToggle } from "./monitoring-mode-toggle";

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
  const mode = resolveMonitoringMode(str(params.mode));
  const { start, endExclusive } = getQuarterDateRange(fiscalYear, quarter);

  const [categoriesResult, budgetsResult] = await Promise.all([
    supabase.from("promotion_categories").select("id, name, type, account_code"),
    supabase
      .from("master_budgets")
      .select("promotion_category_id, total_amount")
      .eq("fiscal_year", fiscalYear)
      .eq("quarter", quarter),
  ]);
  const categories = (categoriesResult.data ?? []) as MonitoringCategory[];
  const budgets = budgetsResult.data ?? [];

  let aggregate;
  let missingStartDate = { count: 0, total: 0 };

  if (mode === "realisasi") {
    const { data } = await supabase
      .from("realizations")
      .select("amount, realization_date, campaign:campaigns(promotion_category_id, status)")
      .gte("realization_date", start)
      .lt("realization_date", endExclusive);

    const realizations: MonitoringRealization[] = (data ?? []).map((r) => {
      const campaign = r.campaign as unknown as {
        promotion_category_id: string | null;
        status: CampaignStatus;
      } | null;
      return {
        promotion_category_id: campaign?.promotion_category_id ?? null,
        amount: r.amount,
        realization_date: r.realization_date,
        campaign_status: campaign?.status ?? "cancelled",
      };
    });

    aggregate = aggregateMonitoringBudgetRealisasi({
      fiscalYear,
      quarter,
      categories,
      budgets,
      realizations,
    });
  } else {
    const [campaignsResult, missingStartDateResult] = await Promise.all([
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

    aggregate = aggregateMonitoringBudget({
      fiscalYear,
      quarter,
      categories,
      budgets,
      campaigns: (campaignsResult.data ?? []) as MonitoringCampaign[],
    });

    missingStartDate = summarizeMissingStartDate(
      missingStartDateResult.data ?? []
    );
  }

  return (
    <MonitoringTable
      aggregate={aggregate}
      mode={mode}
      missingStartDate={missingStartDate}
      periodSelector={
        <MonitoringPeriodSelector
          fiscalYear={fiscalYear}
          quarter={quarter}
          currentFiscalYear={currentFiscalYear}
        />
      }
      modeToggle={<MonitoringModeToggle mode={mode} />}
    />
  );
}

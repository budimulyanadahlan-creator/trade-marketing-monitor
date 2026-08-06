import type { createClient } from "@/lib/supabase/server";
import type { CampaignStatus } from "@/types/database";
import {
  aggregateMonitoringBudget,
  aggregateMonitoringBudgetRealisasi,
  buildKomitmenDrilldown,
  buildRealisasiDrilldown,
  getQuarterDateRange,
  summarizeMissingStartDate,
  MONITORING_COMMITTED_STATUSES,
  type MissingStartDateSummary,
  type MonitoringAggregate,
  type MonitoringCampaign,
  type MonitoringCategory,
  type MonitoringDrilldown,
  type MonitoringMode,
  type MonitoringRealization,
  type DrilldownCampaignInput,
  type DrilldownRealizationInput,
} from "@/lib/monitoring-budget";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type MonitoringBudgetData = {
  aggregate: MonitoringAggregate;
  missingStartDate: MissingStartDateSummary;
  drilldown: MonitoringDrilldown;
};

// Sumber data tunggal untuk agregasi Monitoring Budget — dipakai halaman web
// dan endpoint export Excel, supaya angka di kedua tempat pasti identik.
export async function loadMonitoringBudgetData(
  supabase: SupabaseServerClient,
  { fiscalYear, quarter, mode }: { fiscalYear: number; quarter: number; mode: MonitoringMode }
): Promise<MonitoringBudgetData> {
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

  if (mode === "realisasi") {
    const { data } = await supabase
      .from("realizations")
      .select(
        "id, invoice_number, amount, realization_date, campaign:campaigns(name, promotion_category_id, status)"
      )
      .gte("realization_date", start)
      .lt("realization_date", endExclusive);

    type RealizationRow = {
      id: string;
      invoice_number: string;
      amount: number | null;
      realization_date: string;
      campaign: {
        name: string;
        promotion_category_id: string | null;
        status: CampaignStatus;
      } | null;
    };
    const rows = (data ?? []) as unknown as RealizationRow[];

    const realizations: MonitoringRealization[] = rows.map((r) => ({
      promotion_category_id: r.campaign?.promotion_category_id ?? null,
      amount: r.amount,
      realization_date: r.realization_date,
      campaign_status: r.campaign?.status ?? "cancelled",
    }));

    const aggregate = aggregateMonitoringBudgetRealisasi({
      fiscalYear,
      quarter,
      categories,
      budgets,
      realizations,
    });

    const drilldownRealizations: DrilldownRealizationInput[] = rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      campaign_name: r.campaign?.name ?? "—",
      amount: r.amount,
      realization_date: r.realization_date,
      campaign_status: r.campaign?.status ?? "cancelled",
      promotion_category_id: r.campaign?.promotion_category_id ?? null,
    }));

    return {
      aggregate,
      missingStartDate: { count: 0, total: 0 },
      drilldown: {
        mode: "realisasi",
        data: buildRealisasiDrilldown({ fiscalYear, quarter, realizations: drilldownRealizations }),
      },
    };
  }

  const [campaignsResult, missingStartDateResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, skp_number, name, requested_budget, status, start_date, promotion_category_id, brand:brands(name)"
      )
      .in("status", [...MONITORING_COMMITTED_STATUSES])
      .gte("start_date", start)
      .lt("start_date", endExclusive),
    supabase
      .from("campaigns")
      .select("status, requested_budget, start_date")
      .in("status", [...MONITORING_COMMITTED_STATUSES])
      .is("start_date", null),
  ]);

  type CampaignRow = {
    id: string;
    skp_number: string | null;
    name: string;
    requested_budget: number | null;
    status: CampaignStatus;
    start_date: string | null;
    promotion_category_id: string | null;
    brand: { name: string } | null;
  };
  const rows = (campaignsResult.data ?? []) as unknown as CampaignRow[];

  const aggregate = aggregateMonitoringBudget({
    fiscalYear,
    quarter,
    categories,
    budgets,
    campaigns: rows as MonitoringCampaign[],
  });

  const missingStartDate = summarizeMissingStartDate(missingStartDateResult.data ?? []);

  const drilldownCampaigns: DrilldownCampaignInput[] = rows.map((c) => ({
    id: c.id,
    skp_number: c.skp_number,
    name: c.name,
    brand_name: c.brand?.name ?? null,
    requested_budget: c.requested_budget,
    status: c.status,
    start_date: c.start_date,
    promotion_category_id: c.promotion_category_id,
  }));

  return {
    aggregate,
    missingStartDate,
    drilldown: {
      mode: "komitmen",
      data: buildKomitmenDrilldown({ fiscalYear, quarter, campaigns: drilldownCampaigns }),
    },
  };
}

import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import type { CampaignStatus, UserRole } from "@/types/database";
import { DashboardFilters } from "./dashboard-filters";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { BudgetChart } from "@/components/dashboard/budget-chart";
import { StatusChart } from "@/components/dashboard/status-chart";
import { TopBrands } from "@/components/dashboard/top-brands";
import { AlertSummary } from "@/components/dashboard/alert-summary";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function getQuarterRange(year: number, quarter: number): [string, string] {
  // Fiscal year starts April: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar(+1yr)
  const monthStarts = ["04", "07", "10", "01"];
  const monthEnds   = ["07", "10", "01", "04"];
  const startYear = quarter === 4 ? year + 1 : year;
  const endYear   = quarter >= 3 ? year + 1 : year;
  return [
    `${startYear}-${monthStarts[quarter - 1]}-01`,
    `${endYear}-${monthEnds[quarter - 1]}-01`,
  ];
}

type CampaignRow = {
  id: string;
  name: string;
  requested_budget: number;
  actual_spent: number;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  brand_id: string;
  brand: { name: string } | null;
  department: { name: string } | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const fiscalYear = parseInt(str(params.fiscal_year)) || new Date().getFullYear();
  const quarter = str(params.quarter);
  const departmentId = str(params.department);
  const brandId = str(params.brand);
  const regionId = str(params.region);
  const promoCatId = str(params.promo_category);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch user profile to enforce role-based scoping server-side
  const { data: profile } = await supabase
    .from("users")
    .select("role, department_id, region_id")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "user") as UserRole;

  // Detect Sales Dept user → lock region filter to their region_id
  let lockedRegionId: string | null = null;
  if (role === "user" && profile?.department_id && profile?.region_id) {
    const { data: dept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", profile.department_id)
      .single();
    if (dept?.name?.toLowerCase() === "sales") {
      lockedRegionId = profile.region_id;
    }
  }

  // Region filter: locked for Sales Dept users, otherwise from URL params
  const effectiveRegionId = lockedRegionId ?? regionId;

  // Build campaign query with all filters applied
  let campaignQuery = supabase
    .from("campaigns")
    .select(
      `id, name, requested_budget, actual_spent, status, start_date, end_date, brand_id,
       brand:brands(name),
       department:departments(name)`
    )
    .not("status", "in", "(draft,cancelled)");

  // Explicit server-side scoping by role (defense-in-depth over RLS)
  if (role === "user") {
    campaignQuery = campaignQuery.eq("created_by", user.id);
  } else if (role === "manager" && profile?.department_id) {
    campaignQuery = campaignQuery.eq("department_id", profile.department_id);
  }
  // finance, admin, superadmin: no implicit scope restriction — see all data

  if (departmentId) campaignQuery = campaignQuery.eq("department_id", departmentId);
  if (brandId) campaignQuery = campaignQuery.eq("brand_id", brandId);
  if (effectiveRegionId) campaignQuery = campaignQuery.eq("region_id", effectiveRegionId);
  if (promoCatId)
    campaignQuery = campaignQuery.eq("promotion_category_id", promoCatId);

  // Fetch semua campaign dalam rentang luas (fiscal year ± buffer), lalu filter overlap di JS
  // Ini lebih reliabel daripada OR filter di PostgREST
  const fiscalYearStart = `${fiscalYear}-04-01`;
  const fiscalYearEnd   = `${fiscalYear + 1}-04-01`;
  campaignQuery = campaignQuery
    .lt("start_date", fiscalYearEnd)
    .gte("start_date", `${fiscalYear - 1}-01-01`); // buffer untuk campaign multi-quarter

  // Master budget query: untuk KPI card (filtered by quarter if selected)
  let masterBudgetQuery = supabase
    .from("master_budgets")
    .select("total_amount, fiscal_year, quarter, promotion_category_id")
    .eq("fiscal_year", fiscalYear);

  if (quarter && ["1", "2", "3", "4"].includes(quarter)) {
    masterBudgetQuery = masterBudgetQuery.eq("quarter", parseInt(quarter));
  }
  if (promoCatId) {
    masterBudgetQuery = masterBudgetQuery.eq("promotion_category_id", promoCatId);
  }

  // Master budget semua quarter (untuk chart — tidak difilter per quarter)
  let allQuarterBudgetQuery = supabase
    .from("master_budgets")
    .select("total_amount, quarter")
    .eq("fiscal_year", fiscalYear);
  if (promoCatId) {
    allQuarterBudgetQuery = allQuarterBudgetQuery.eq("promotion_category_id", promoCatId);
  }

  // Run all queries in parallel
  const [
    { data: departments },
    { data: brands },
    { data: regions },
    { data: categories },
    { data: rawCampaigns },
    { data: rawMasterBudgets },
    { data: rawAllQuarterBudgets },
  ] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("promotion_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    campaignQuery,
    masterBudgetQuery,
    allQuarterBudgetQuery,
  ]);

  let campaigns = (rawCampaigns ?? []) as CampaignRow[];

  // Filter by quarter overlap in JavaScript (avoids PostgREST OR syntax issues)
  if (quarter && ["1", "2", "3", "4"].includes(quarter)) {
    const [dateStart, dateEnd] = getQuarterRange(fiscalYear, parseInt(quarter));
    campaigns = campaigns.filter((c) => {
      if (!c.start_date) return false;
      const startsBefore = c.start_date < dateEnd;
      const endsAfter = !c.end_date || c.end_date >= dateStart;
      return startsBefore && endsAfter;
    });
  } else {
    // No quarter filter: show campaigns overlapping the fiscal year
    campaigns = campaigns.filter((c) => {
      if (!c.start_date) return false;
      const startsBefore = c.start_date < fiscalYearEnd;
      const endsAfter = !c.end_date || c.end_date >= fiscalYearStart;
      return startsBefore && endsAfter;
    });
  }

  // ── Aggregations ──────────────────────────────────────────────────────────

  // Total Budget: dari master_budgets (budget yang dialokasikan untuk periode ini)
  const totalMasterBudget = (rawMasterBudgets ?? []).reduce(
    (s, b) => s + (b.total_amount ?? 0), 0
  );
  // Total SKP Budget: sum requested_budget campaign (budget yang sudah diklaim di SKP)
  const totalSkpBudget = campaigns.reduce((s, c) => s + c.requested_budget, 0);
  // Total SKP Budget hanya yang disetujui (untuk role user)
  const APPROVED_STATUSES: CampaignStatus[] = ["approved", "ongoing", "claim_submitted", "paid", "completed"];
  const totalSkpBudgetApproved = campaigns
    .filter((c) => APPROVED_STATUSES.includes(c.status))
    .reduce((s, c) => s + c.requested_budget, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.actual_spent, 0);
  const activeCampaigns = campaigns.filter(
    (c) => c.status === "approved" || c.status === "ongoing"
  ).length;

  // Budget vs. actual by quarter (always show all 4)
  // budget = master_budgets.total_amount per quarter, spent = campaign actual_spent
  const quarterData = [
    { quarter: "Q1", budget: 0, spent: 0 },
    { quarter: "Q2", budget: 0, spent: 0 },
    { quarter: "Q3", budget: 0, spent: 0 },
    { quarter: "Q4", budget: 0, spent: 0 },
  ];

  // Isi budget dari master_budgets (fetch all quarters tanpa filter quarter)
  for (const b of rawAllQuarterBudgets ?? []) {
    const q = (b.quarter as number) - 1;
    if (q >= 0 && q < 4) quarterData[q].budget += b.total_amount ?? 0;
  }

  // Isi spent dari campaigns berdasarkan start_date quarter
  for (const c of campaigns) {
    if (c.start_date) {
      const month = new Date(c.start_date).getMonth() + 1;
      // Fiscal Q1=Apr-Jun(4-6), Q2=Jul-Sep(7-9), Q3=Oct-Dec(10-12), Q4=Jan-Mar(1-3)
      const q = month >= 4 ? Math.ceil((month - 3) / 3) - 1 : 3;
      if (q >= 0 && q < 4) quarterData[q].spent += c.actual_spent;
    }
  }

  // Status distribution
  const statusCounts: Record<string, number> = {};
  for (const c of campaigns) {
    statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1;
  }

  // Top 5 brands by actual_spent
  const brandMap = new Map<string, { name: string; spent: number; budget: number }>();
  for (const c of campaigns) {
    const name = c.brand?.name ?? "Unknown";
    const prev = brandMap.get(c.brand_id) ?? { name, spent: 0, budget: 0 };
    prev.spent += c.actual_spent;
    prev.budget += c.requested_budget;
    brandMap.set(c.brand_id, prev);
  }
  const topBrands = Array.from(brandMap.values())
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  // Alert summary: campaigns ≥ 80% spent
  const alertCampaigns = campaigns
    .filter((c) => c.requested_budget > 0 && c.actual_spent / c.requested_budget >= 0.8)
    .map((c) => ({
      id: c.id,
      name: c.name,
      brand: c.brand?.name ?? "",
      department: c.department?.name ?? "",
      requested_budget: c.requested_budget,
      actual_spent: c.actual_spent,
      percentage: c.actual_spent / c.requested_budget,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  const scopeLabel =
    lockedRegionId
      ? "SKP region Anda"
      : role === "user"
      ? "SKP milik Anda"
      : role === "manager"
      ? "SKP departemen Anda"
      : "Semua SKP";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Dashboard</h1>
          <p className="text-slate-400 text-sm">
            Ringkasan anggaran dan status campaign fiskal {fiscalYear}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
          Cakupan: {scopeLabel}
        </span>
      </div>

      <Suspense
        fallback={
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-10 w-32 rounded-md bg-white/5 animate-pulse" />
            ))}
          </div>
        }
      >
        <DashboardFilters
          departments={departments ?? []}
          brands={brands ?? []}
          regions={regions ?? []}
          categories={categories ?? []}
          fiscalYear={fiscalYear}
          canExportPdf={["admin", "finance", "manager", "superadmin"].includes(role)}
          lockedRegionId={lockedRegionId}
        />
      </Suspense>

      {/* KPI Cards */}
      {role === "user" ? (
        <div className="grid grid-cols-2 gap-4">
          <KpiCard label="Total SKP Budget (Disetujui)" value={totalSkpBudgetApproved} type="currency" />
          <KpiCard label="Total Realisasi" value={totalSpent} type="currency" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Master Budget" value={totalMasterBudget} type="currency" />
          <KpiCard label="Total SKP Budget" value={totalSkpBudget} type="currency" />
          <KpiCard label="Total Realisasi" value={totalSpent} type="currency" />
          <KpiCard
            label="Sisa Anggaran"
            value={totalMasterBudget - totalSpent}
            type="currency"
            trend={
              totalMasterBudget > 0
                ? ((totalMasterBudget - totalSpent) / totalMasterBudget) * 100
                : undefined
            }
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <BudgetChart data={quarterData} />
        </div>
        <StatusChart data={statusCounts} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopBrands data={topBrands} />
        <AlertSummary campaigns={alertCampaigns} />
      </div>
    </div>
  );
}

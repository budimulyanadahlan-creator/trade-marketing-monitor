import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { getFiscalPeriod, resolveFiscalPeriod, resolveMonitoringMode } from "@/lib/monitoring-budget";
import { loadMonitoringBudgetData } from "@/lib/monitoring-budget-data";
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

  const { aggregate, missingStartDate, missingRegion, drilldown } = await loadMonitoringBudgetData(supabase, {
    fiscalYear,
    quarter,
    mode,
  });

  const exportHref = `/api/export/monitoring-budget?fy=${fiscalYear}&q=${quarter}&mode=${mode}`;

  return (
    <MonitoringTable
      aggregate={aggregate}
      mode={mode}
      missingStartDate={missingStartDate}
      missingRegion={missingRegion}
      periodSelector={
        <MonitoringPeriodSelector
          fiscalYear={fiscalYear}
          quarter={quarter}
          currentFiscalYear={currentFiscalYear}
        />
      }
      modeToggle={<MonitoringModeToggle mode={mode} />}
      drilldown={drilldown}
      exportHref={exportHref}
    />
  );
}

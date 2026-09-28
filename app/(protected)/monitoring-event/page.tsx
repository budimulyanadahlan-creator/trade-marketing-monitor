import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFiscalPeriod, resolveFiscalPeriod } from "@/lib/monitoring-budget";
import { MonitoringPeriodSelector } from "../monitoring-budget/monitoring-period-selector";
import { requirePosmViewer } from "../monitoring-posm/viewer";
import { EventsTable, type EventListRow } from "./events-table";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type CostEmbed = { planned_budget: number; planned_sample_budget: number } | null;

export default async function MonitoringEventPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Distributor dialihkan sampai fase 7; hak tulis = can_manage_posm().
  const { supabase, canManage, isAdmin } = await requirePosmViewer();

  const params = await searchParams;
  const currentFiscalYear = getFiscalPeriod(new Date()).fiscalYear;
  const { fiscalYear, quarter } = resolveFiscalPeriod(str(params.fy), str(params.q));

  const [{ data: events }, { data: regions }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, name, event_type, start_date, end_date, location, pic_name, target_participants, target_sales, status, region:regions(name), costs:event_costs(planned_budget, planned_sample_budget)"
      )
      .eq("fiscal_year", fiscalYear)
      .eq("quarter", quarter)
      .is("deleted_at", null)
      .order("start_date")
      .order("created_at"),
    supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
  ]);

  const rows: EventListRow[] = (events ?? []).map(({ region, costs, ...e }) => {
    const c = costs as CostEmbed;
    return {
      ...e,
      region_name: (region as { name: string } | null)?.name ?? null,
      planned_budget: c?.planned_budget ?? null,
      planned_sample_budget: c?.planned_sample_budget ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Monitoring Event</h1>
          <p className="text-slate-400 text-sm">
            Event dan aktivitas lapangan per kuartal fiskal
            {!canManage && <span className="text-slate-600"> • mode baca saja</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link href="/monitoring-event/audit">
                <History className="h-4 w-4" />
                Audit Log
              </Link>
            </Button>
          )}
          <MonitoringPeriodSelector
            fiscalYear={fiscalYear}
            quarter={quarter}
            currentFiscalYear={currentFiscalYear}
          />
        </div>
      </div>

      <EventsTable
        events={rows}
        regions={regions ?? []}
        canManage={canManage}
        periodLabel={`FY ${fiscalYear} Q${quarter}`}
      />
    </div>
  );
}

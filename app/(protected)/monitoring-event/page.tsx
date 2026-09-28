import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseEventListFilters } from "@/lib/event";
import { getFiscalPeriod, resolveFiscalPeriod } from "@/lib/monitoring-budget";
import { MonitoringPeriodSelector } from "../monitoring-budget/monitoring-period-selector";
import { requirePosmViewer } from "../monitoring-posm/viewer";
import { EventFilters } from "./event-filters";
import { EventsTable, type EventListRow } from "./events-table";
import { loadEventFormOptions } from "./form-options";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type CostEmbed = { planned_budget: number; planned_sample_budget: number } | null;
type BrandEmbed = { deleted_at: string | null; brand: { name: string } | null }[];

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
  const filters = parseEventListFilters(params);

  // Filter brand lewat tautan aktif di event_brands.
  const brandEventIds = filters.brand
    ? (
        await supabase
          .from("event_brands")
          .select("event_id")
          .eq("brand_id", filters.brand)
          .is("deleted_at", null)
      ).data?.map((l) => l.event_id) ?? []
    : null;

  let query = supabase
    .from("events")
    .select(
      "id, name, event_type, start_date, end_date, location, pic_name, target_participants, target_sales, status, region:regions(name), costs:event_costs(planned_budget, planned_sample_budget), brands:event_brands(deleted_at, brand:brands(name))"
    )
    .eq("fiscal_year", fiscalYear)
    .eq("quarter", quarter)
    .is("deleted_at", null);
  if (filters.type) query = query.eq("event_type", filters.type);
  if (filters.region) query = query.eq("region_id", filters.region);
  if (filters.status) query = query.eq("status", filters.status);
  if (brandEventIds) query = query.in("id", brandEventIds);

  // Filter memakai semua region/brand (termasuk nonaktif) agar event lama
  // tetap bisa dicari; form hanya menawarkan yang aktif.
  const [{ data: events }, { data: allRegions }, { data: allBrands }, formOptions] = await Promise.all([
    query.order("start_date").order("created_at"),
    supabase.from("regions").select("id, name").order("name"),
    supabase.from("brands").select("id, name").order("name"),
    canManage ? loadEventFormOptions(supabase) : null,
  ]);

  const rows: EventListRow[] = (events ?? []).map(({ region, costs, brands, ...e }) => {
    const c = costs as CostEmbed;
    return {
      ...e,
      region_name: (region as { name: string } | null)?.name ?? null,
      brand_names: (brands as BrandEmbed)
        .filter((b) => !b.deleted_at && b.brand)
        .map((b) => b.brand!.name)
        .sort(),
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

      <EventFilters filters={filters} regions={allRegions ?? []} brands={allBrands ?? []} />

      <EventsTable
        events={rows}
        formOptions={formOptions}
        filtered={Object.keys(filters).length > 0}
        periodLabel={`FY ${fiscalYear} Q${quarter}`}
      />
    </div>
  );
}

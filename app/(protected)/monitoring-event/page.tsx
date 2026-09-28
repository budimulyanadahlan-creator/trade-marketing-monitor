import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  eventListSelect,
  eventLacksPhoto,
  eventNeedsUpdate,
  parseEventListFilters,
  publicEventKpis,
  summarizeEventKpis,
  todayInJakarta,
  type EventKpiSource,
} from "@/lib/event";
import { getFiscalPeriod, resolveFiscalPeriod } from "@/lib/monitoring-budget";
import { MonitoringPeriodSelector } from "../monitoring-budget/monitoring-period-selector";
import { EventFilters } from "./event-filters";
import { EventKpiRow } from "./event-kpis";
import { EventsTable, type EventListRow } from "./events-table";
import { loadEventFormOptions } from "./form-options";
import { requireEventViewer } from "./viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type CostEmbed = { planned_budget: number; planned_sample_budget: number; actual_budget: number | null } | null;
type SamplingEmbed = { deleted_at: string | null; cost: { value: number } | null }[];
type BrandEmbed = { deleted_at: string | null; brand: { name: string } | null }[];

// Bentuk baris eventListSelect(); costs & samplings hanya ada untuk internal.
type EventListQueryRow = Pick<
  EventListRow,
  | "id"
  | "name"
  | "event_type"
  | "start_date"
  | "end_date"
  | "location"
  | "pic_name"
  | "target_participants"
  | "target_sales"
  | "status"
> & {
  actual_participants: number | null;
  actual_sales: number | null;
  region: { name: string } | null;
  brands: BrandEmbed;
  photos: { deleted_at: string | null }[];
  costs?: CostEmbed;
  samplings?: SamplingEmbed;
};

export default async function MonitoringEventPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Distributor hanya melihat event region/distributornya (RLS migrasi 059)
  // dan tanpa biaya; hak tulis = can_manage_posm().
  const { supabase, showCosts, canManage, isAdmin } = await requireEventViewer();

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
    .select(eventListSelect({ showCosts }))
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

  const today = todayInJakarta();

  // KPI memakai baris yang sama dengan tabel, sehingga ikut kuartal dan
  // semua filter; event terhapus sudah tersaring di query.
  const kpiSources: EventKpiSource[] = [];

  const rows: EventListRow[] = ((events ?? []) as unknown as EventListQueryRow[]).map(
    ({ region, costs, brands, samplings, photos, actual_participants, actual_sales, ...e }) => {
      const c = costs ?? null;
      const optional = (v: number | null | undefined) => (v == null ? null : Number(v));
      kpiSources.push({
        status: e.status,
        target_participants: Number(e.target_participants),
        target_sales: Number(e.target_sales),
        actual_participants: optional(actual_participants),
        actual_sales: optional(actual_sales),
        planned_budget: Number(c?.planned_budget ?? 0),
        actual_budget: optional(c?.actual_budget),
        planned_sample_budget: Number(c?.planned_sample_budget ?? 0),
        sampling_value: (samplings ?? [])
          .filter((s) => !s.deleted_at)
          .reduce((sum, s) => sum + Number(s.cost?.value ?? 0), 0),
      });
      return {
        ...e,
        region_name: region?.name ?? null,
        brand_names: brands
          .filter((b) => !b.deleted_at && b.brand)
          .map((b) => b.brand!.name)
          .sort(),
        // Kunci biaya tidak dikirim sama sekali ke browser distributor.
        ...(showCosts && {
          planned_budget: c?.planned_budget ?? null,
          planned_sample_budget: c?.planned_sample_budget ?? null,
        }),
        needs_update: eventNeedsUpdate(e, today),
        lacks_photo: eventLacksPhoto(e, photos.filter((p) => !p.deleted_at).length),
      };
    }
  );
  const kpis = summarizeEventKpis(kpiSources);

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

      <EventKpiRow kpis={showCosts ? kpis : publicEventKpis(kpis)} />

      <EventsTable
        events={rows}
        formOptions={formOptions}
        showCosts={showCosts}
        filtered={Object.keys(filters).length > 0}
        periodLabel={`FY ${fiscalYear} Q${quarter}`}
      />
    </div>
  );
}

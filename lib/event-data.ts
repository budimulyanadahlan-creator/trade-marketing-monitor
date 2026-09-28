import type { createClient } from "@/lib/supabase/server";
import {
  canViewEvent,
  eventExportSelect,
  eventFilterLabel,
  eventLacksPhoto,
  eventNeedsUpdate,
  type EventListFilters,
  type EventViewer,
} from "@/lib/event";
import type { EventExportData, EventExportRow, EventSamplingExportRow } from "@/lib/event-excel";
import type { EventStatus, EventType } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type EventPeriod = { fiscalYear: number; quarter: number };

/**
 * Query events satu kuartal fiskal dengan filter tabel, dipakai halaman
 * daftar dan export agar isinya sama. Event terhapus tidak ikut.
 */
export async function queryEventsForPeriod(
  supabase: SupabaseServerClient,
  select: string,
  { fiscalYear, quarter }: EventPeriod,
  filters: EventListFilters
) {
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
    .select(select)
    .eq("fiscal_year", fiscalYear)
    .eq("quarter", quarter)
    .is("deleted_at", null);
  if (filters.type) query = query.eq("event_type", filters.type);
  if (filters.region) query = query.eq("region_id", filters.region);
  if (filters.status) query = query.eq("status", filters.status);
  if (brandEventIds) query = query.in("id", brandEventIds);

  return query.order("start_date").order("created_at");
}

type Named = { name: string } | null;

// Bentuk baris eventExportSelect(); costs & cost sampling hanya ada untuk internal.
type EventExportQueryRow = {
  id: string;
  name: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  region_id: string;
  distributor_id: string | null;
  location: string;
  pic_name: string;
  target_participants: number;
  target_sales: number | string;
  status: EventStatus;
  actual_participants: number | null;
  actual_sales: number | string | null;
  cancel_reason: string | null;
  notes: string | null;
  region: Named;
  distributor: Named;
  brands: { deleted_at: string | null; brand: Named }[];
  campaigns: { campaign_id: string | null; skp_number: string | null; deleted_at: string | null; created_at: string }[];
  photos: { deleted_at: string | null }[];
  samplings: {
    product_name: string;
    quantity: number | string;
    unit: string;
    sort_order: number;
    created_at: string;
    deleted_at: string | null;
    cost?: { value: number | string } | null;
  }[];
  costs?: {
    planned_budget: number | string;
    planned_sample_budget: number | string;
    actual_budget: number | string | null;
    vendor: Named;
  } | null;
};

const optional = (v: number | string | null | undefined) => (v == null ? null : Number(v));

/**
 * Data export Excel Monitoring Event untuk kuartal dan filter aktif. Tanpa
 * `showCosts` (distributor), biaya, nilai sampling, dan vendor tidak diminta
 * sama sekali; baris event dibatasi RLS migrasi 059 dan canViewEvent.
 */
export async function loadEventExportData(
  supabase: SupabaseServerClient,
  {
    period,
    filters,
    viewer,
    today,
  }: { period: EventPeriod; filters: EventListFilters; viewer: EventViewer; today: string }
): Promise<EventExportData> {
  const showCosts = viewer.role !== "distributor";

  const [{ data, error }, { data: regions }, { data: brands }] = await Promise.all([
    queryEventsForPeriod(supabase, eventExportSelect({ showCosts }), period, filters),
    filters.region
      ? supabase.from("regions").select("id, name").eq("id", filters.region)
      : Promise.resolve({ data: [] }),
    filters.brand ? supabase.from("brands").select("id, name").eq("id", filters.brand) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(`Gagal memuat event: ${error.message}`);

  // Lapis kedua selain RLS, sama dengan halaman detail.
  const events = ((data ?? []) as unknown as EventExportQueryRow[]).filter((e) => canViewEvent(e, viewer));

  // Nomor SKP terkini lewat event_campaign_refs (migrasi 056/059); SKP yang
  // dihapus permanen memakai snapshot nomor di event_campaigns.
  const campaignIds = [
    ...new Set(events.flatMap((e) => e.campaigns.flatMap((c) => (!c.deleted_at && c.campaign_id ? [c.campaign_id] : [])))),
  ];
  const { data: refs } = campaignIds.length
    ? await supabase.rpc("event_campaign_refs", { p_ids: campaignIds })
    : { data: [] };
  const skpById = new Map((refs ?? []).map((r) => [r.id, r.skp_number]));

  const rows: EventExportRow[] = [];
  const samplings: EventSamplingExportRow[] = [];

  events.forEach((e, i) => {
    const no = i + 1;
    const activeSamplings = e.samplings
      .filter((s) => !s.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    const c = e.costs ?? null;

    rows.push({
      no,
      name: e.name,
      event_type: e.event_type,
      start_date: e.start_date,
      end_date: e.end_date,
      region_name: e.region?.name ?? null,
      location: e.location,
      distributor_name: e.distributor?.name ?? null,
      pic_name: e.pic_name,
      brand_names: e.brands
        .filter((b) => !b.deleted_at && b.brand)
        .map((b) => b.brand!.name)
        .sort(),
      skp_numbers: e.campaigns
        .filter((l) => !l.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((l) => (l.campaign_id ? skpById.get(l.campaign_id) : null) ?? l.skp_number ?? "Tanpa nomor"),
      status: e.status,
      target_participants: Number(e.target_participants),
      target_sales: Number(e.target_sales),
      actual_participants: optional(e.actual_participants),
      actual_sales: optional(e.actual_sales),
      cancel_reason: e.cancel_reason,
      notes: e.notes,
      needs_update: eventNeedsUpdate(e, today),
      lacks_photo: eventLacksPhoto(e, e.photos.filter((p) => !p.deleted_at).length),
      ...(showCosts && {
        costs: {
          planned_budget: Number(c?.planned_budget ?? 0),
          actual_budget: optional(c?.actual_budget),
          planned_sample_budget: Number(c?.planned_sample_budget ?? 0),
          sampling_value: activeSamplings.reduce((sum, s) => sum + Number(s.cost?.value ?? 0), 0),
          vendor_name: c?.vendor?.name ?? null,
        },
      }),
    });

    for (const s of activeSamplings) {
      samplings.push({
        event_no: no,
        event_name: e.name,
        start_date: e.start_date,
        region_name: e.region?.name ?? null,
        product_name: s.product_name,
        quantity: Number(s.quantity),
        unit: s.unit,
        ...(showCosts && { value: Number(s.cost?.value ?? 0) }),
      });
    }
  });

  return {
    fiscalYear: period.fiscalYear,
    quarter: period.quarter,
    filterLabel: eventFilterLabel(filters, {
      region: new Map((regions ?? []).map((r) => [r.id, r.name])),
      brand: new Map((brands ?? []).map((b) => [b.id, b.name])),
    }),
    showCosts,
    events: rows,
    samplings,
  };
}

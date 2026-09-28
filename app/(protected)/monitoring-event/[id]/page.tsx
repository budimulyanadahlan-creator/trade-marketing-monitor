import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EVENT_STATUS_LABELS, eventFiscalPeriod } from "@/lib/event";
import { auditFiltersQuery, formatAuditTimestamp } from "@/lib/posm";
import { formatIDR } from "@/lib/utils";
import { requirePosmViewer } from "../../monitoring-posm/viewer";
import { EVENT_STATUS_VARIANT, formatEventDateRange } from "../event-display";
import { EventDetailActions } from "./event-detail-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CostEmbed = { planned_budget: number; planned_sample_budget: number } | null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200">{children}</dd>
    </div>
  );
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Distributor dialihkan sampai fase 7; hak tulis = can_manage_posm().
  const { supabase, canManage, isAdmin } = await requirePosmViewer();

  if (!UUID.test(id)) notFound();

  const [{ data: event }, { data: regions }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, name, event_type, start_date, end_date, region_id, location, pic_name, target_participants, target_sales, status, created_at, updated_at, region:regions(name), costs:event_costs(planned_budget, planned_sample_budget), creator:users!events_created_by_fkey(full_name), updater:users!events_updated_by_fkey(full_name)"
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    canManage
      ? supabase.from("regions").select("id, name").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] }),
  ]);

  // Event terhapus diperlakukan sama dengan id yang tidak ada.
  if (!event) notFound();

  const { region, costs, creator, updater, ...e } = event;
  const regionName = (region as { name: string } | null)?.name ?? null;
  const cost = costs as CostEmbed;
  const creatorName = (creator as { full_name: string } | null)?.full_name;
  const updaterName = (updater as { full_name: string } | null)?.full_name;
  const { fiscalYear, quarter } = eventFiscalPeriod(e.start_date);

  // Region nonaktif milik event lama tetap bisa dipilih saat edit.
  const regionOptions = [...(regions ?? [])];
  if (regionName && !regionOptions.some((r) => r.id === e.region_id)) {
    regionOptions.push({ id: e.region_id, name: `${regionName} (nonaktif)` });
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/monitoring-event?fy=${fiscalYear}&q=${quarter}`}
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring Event
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={EVENT_STATUS_VARIANT[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>
            <Badge variant="outline">{e.event_type}</Badge>
            <span className="text-xs text-slate-500">
              FY {fiscalYear} Q{quarter}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{e.name}</h1>
          <p className="text-sm text-slate-400">
            {formatEventDateRange(e.start_date, e.end_date)} • {e.location}
            {regionName && ` • ${regionName}`}
          </p>
          {isAdmin && (
            <Link
              href={`/monitoring-event/audit?${auditFiltersQuery({ record: e.id })}`}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-300"
            >
              <History className="h-3.5 w-3.5" />
              Riwayat perubahan
            </Link>
          )}
        </div>

        {canManage && cost && (
          <EventDetailActions
            regions={regionOptions}
            event={{
              id: e.id,
              name: e.name,
              event_type: e.event_type,
              start_date: e.start_date,
              end_date: e.end_date,
              region_id: e.region_id,
              location: e.location,
              pic_name: e.pic_name,
              target_participants: e.target_participants,
              target_sales: Number(e.target_sales),
              planned_budget: Number(cost.planned_budget),
              planned_sample_budget: Number(cost.planned_sample_budget),
            }}
          />
        )}
      </div>

      <section className="rounded-xl border border-white/8 bg-white/2 p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-300">Rencana</h2>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Jenis">{e.event_type}</Field>
          <Field label="Tanggal">{formatEventDateRange(e.start_date, e.end_date)}</Field>
          <Field label="Region">{regionName ?? "—"}</Field>
          <Field label="Lokasi / Outlet">{e.location}</Field>
          <Field label="PIC">{e.pic_name}</Field>
          <Field label="Target Peserta">
            <span className="tabular-nums">{e.target_participants.toLocaleString("id-ID")}</span>
          </Field>
          <Field label="Target Sales">
            <span className="tabular-nums">{formatIDR(Number(e.target_sales))}</span>
          </Field>
          <Field label="Rencana Budget Event">
            <span className="tabular-nums">{cost ? formatIDR(Number(cost.planned_budget)) : "—"}</span>
          </Field>
          <Field label="Rencana Budget Sample">
            <span className="tabular-nums">{cost ? formatIDR(Number(cost.planned_sample_budget)) : "—"}</span>
          </Field>
        </dl>
      </section>

      <p className="text-xs text-slate-500">
        Dibuat {creatorName ? `oleh ${creatorName} ` : ""}
        {formatAuditTimestamp(e.created_at)}
        {updaterName && ` • Diubah oleh ${updaterName} ${formatAuditTimestamp(e.updated_at)}`}
      </p>
    </div>
  );
}

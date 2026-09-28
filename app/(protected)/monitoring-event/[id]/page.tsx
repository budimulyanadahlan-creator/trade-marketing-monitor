import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getStatusConfig } from "@/lib/campaign-status";
import { EVENT_STATUS_LABELS, eventFiscalPeriod } from "@/lib/event";
import { auditFiltersQuery, formatAuditTimestamp } from "@/lib/posm";
import { cn, formatIDR } from "@/lib/utils";
import type { CampaignStatus } from "@/types/database";
import { requirePosmViewer } from "../../monitoring-posm/viewer";
import { EVENT_STATUS_VARIANT, formatEventDateRange } from "../event-display";
import { loadEventFormOptions } from "../form-options";
import { EventDetailActions } from "./event-detail-actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = { name: string } | null;
type CostEmbed = {
  planned_budget: number;
  planned_sample_budget: number;
  vendor_id: string | null;
  vendor: Named;
} | null;
type BrandEmbed = { brand_id: string; deleted_at: string | null; brand: Named }[];
type CampaignEmbed = {
  campaign_id: string | null;
  skp_number: string | null;
  campaign_name: string | null;
  deleted_at: string | null;
  created_at: string;
}[];

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
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

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, name, event_type, start_date, end_date, region_id, distributor_id, location, pic_name, target_participants, target_sales, status, notes, created_at, updated_at, region:regions(name), distributor:distributors(name), costs:event_costs(planned_budget, planned_sample_budget, vendor_id, vendor:vendors(name)), brands:event_brands(brand_id, deleted_at, brand:brands(name)), campaigns:event_campaigns(campaign_id, skp_number, campaign_name, deleted_at, created_at), creator:users!events_created_by_fkey(full_name), updater:users!events_updated_by_fkey(full_name)"
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  // Event terhapus diperlakukan sama dengan id yang tidak ada.
  if (!event) notFound();

  const { region, distributor, costs, brands, campaigns, creator, updater, ...e } = event;
  const regionName = (region as Named)?.name ?? null;
  const distributorName = (distributor as Named)?.name ?? null;
  const cost = costs as CostEmbed;
  const vendorName = cost?.vendor?.name ?? null;
  const creatorName = (creator as { full_name: string } | null)?.full_name;
  const updaterName = (updater as { full_name: string } | null)?.full_name;
  const { fiscalYear, quarter } = eventFiscalPeriod(e.start_date);

  const linkedBrands = (brands as BrandEmbed)
    .filter((b) => !b.deleted_at)
    .map((b) => ({ id: b.brand_id, name: b.brand?.name ?? b.brand_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const linkedCampaigns = (campaigns as CampaignEmbed)
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Nomor/judul/status terkini lewat event_campaign_refs (migrasi 056),
  // karena RLS campaigns tidak mengizinkan semua pembaca melihat SKP ini.
  // SKP yang dihapus permanen (campaign_id null) memakai snapshot.
  const campaignIds = linkedCampaigns.flatMap((c) => (c.campaign_id ? [c.campaign_id] : []));
  const [{ data: refs }, formOptions] = await Promise.all([
    campaignIds.length ? supabase.rpc("event_campaign_refs", { p_ids: campaignIds }) : Promise.resolve({ data: [] }),
    canManage && cost
      ? loadEventFormOptions(supabase, {
          region: regionName ? { id: e.region_id, name: regionName } : null,
          distributor: e.distributor_id && distributorName ? { id: e.distributor_id, name: distributorName } : null,
          vendor: cost.vendor_id && vendorName ? { id: cost.vendor_id, name: vendorName } : null,
          brands: linkedBrands,
        })
      : null,
  ]);
  const refById = new Map((refs ?? []).map((r) => [r.id, r]));
  const skps = linkedCampaigns.map((c) => {
    const ref = c.campaign_id ? refById.get(c.campaign_id) : undefined;
    return {
      id: c.campaign_id,
      skp_number: ref?.skp_number ?? c.skp_number,
      name: ref?.name ?? c.campaign_name ?? "SKP",
      status: (ref?.status ?? null) as CampaignStatus | null,
    };
  });

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

        {formOptions && cost && (
          <EventDetailActions
            options={formOptions}
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
              distributor_id: e.distributor_id,
              vendor_id: cost.vendor_id,
              notes: e.notes,
              brand_ids: linkedBrands.map((b) => b.id),
              // SKP yang dihapus permanen tidak bisa dipilih ulang; tautannya
              // dibiarkan oleh update_event.
              campaigns: skps.flatMap((s) => (s.id ? [{ id: s.id, skp_number: s.skp_number, name: s.name }] : [])),
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

      <section className="rounded-xl border border-white/8 bg-white/2 p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-300">Tautan</h2>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Brand">
            {linkedBrands.length ? (
              <span className="flex flex-wrap gap-1.5">
                {linkedBrands.map((b) => (
                  <Badge key={b.id} variant="outline">
                    {b.name}
                  </Badge>
                ))}
              </span>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Distributor">{distributorName ?? "—"}</Field>
          <Field label="Vendor Penyelenggara">{vendorName ?? "—"}</Field>
          <Field label="SKP Terkait" className="sm:col-span-2 lg:col-span-4">
            {skps.length ? (
              <ul className="space-y-1.5">
                {skps.map((s, i) => (
                  <li key={s.id ?? `deleted-${i}`} className="flex flex-wrap items-center gap-2">
                    {s.id ? (
                      <Link href={`/campaigns/${s.id}`} className="text-emerald-300 hover:underline underline-offset-4">
                        <code>{s.skp_number ?? "Tanpa nomor"}</code>
                      </Link>
                    ) : (
                      <code className="text-slate-400">{s.skp_number ?? "Tanpa nomor"}</code>
                    )}
                    <span className="text-slate-400">{s.name}</span>
                    {s.status ? (
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs",
                          getStatusConfig(s.status).className
                        )}
                      >
                        {getStatusConfig(s.status).label}
                      </span>
                    ) : (
                      !s.id && <span className="text-xs text-slate-500">(SKP dihapus)</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Keterangan" className="sm:col-span-2 lg:col-span-4">
            {e.notes ? <span className="whitespace-pre-line">{e.notes}</span> : "—"}
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

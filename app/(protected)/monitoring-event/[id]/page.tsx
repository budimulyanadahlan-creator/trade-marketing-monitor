import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowLeft, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getStatusConfig } from "@/lib/campaign-status";
import { isDistributorAllowedOnCampaign } from "@/lib/distributor-campaign-guard";
import {
  canViewEvent,
  EVENT_STATUS_LABELS,
  eventDetailSelect,
  eventFiscalPeriod,
  eventLacksPhoto,
  eventNeedsUpdate,
  EVENT_PHOTO_BUCKET,
  todayInJakarta,
} from "@/lib/event";
import { auditFiltersQuery, formatAuditTimestamp } from "@/lib/posm";
import { cn, formatIDR } from "@/lib/utils";
import type { CampaignStatus, EventRow } from "@/types/database";
import { EVENT_STATUS_VARIANT, formatEventDateRange, NeedsUpdateBadge, NoPhotoBadge } from "../event-display";
import { loadEventFormOptions } from "../form-options";
import { signPosmPhotos } from "../../monitoring-posm/photo-urls";
import { requireEventViewer } from "../viewer";
import { EventDetailActions } from "./event-detail-actions";
import { EventPhotoGallery } from "./event-photo-gallery";
import { EventSamplingSection, type EventSamplingItem } from "./event-sampling-section";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = { name: string } | null;
type CostEmbed = {
  planned_budget: number;
  planned_sample_budget: number;
  actual_budget: number | null;
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
type SamplingEmbed = {
  id: string;
  product_name: string;
  quantity: number;
  unit: string;
  sort_order: number;
  created_at: string;
  deleted_at: string | null;
  /** Tidak ada untuk distributor (eventDetailSelect tanpa biaya). */
  cost?: { value: number } | null;
}[];

// Bentuk baris eventDetailSelect(); costs hanya ada untuk internal.
type EventDetailQueryRow = Pick<
  EventRow,
  | "id"
  | "name"
  | "event_type"
  | "start_date"
  | "end_date"
  | "region_id"
  | "distributor_id"
  | "location"
  | "pic_name"
  | "target_participants"
  | "target_sales"
  | "status"
  | "actual_participants"
  | "actual_sales"
  | "cancel_reason"
  | "notes"
  | "created_at"
  | "updated_at"
> & {
  region: Named;
  distributor: Named;
  costs?: CostEmbed;
  brands: BrandEmbed;
  campaigns: CampaignEmbed;
  samplings: SamplingEmbed;
  creator: { full_name: string } | null;
  updater: { full_name: string } | null;
};

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
  // Distributor hanya melihat event region/distributornya (RLS migrasi 059)
  // dan tanpa biaya, nilai sampling, maupun vendor; hak tulis = can_manage_posm().
  const { supabase, viewer, showCosts, canManage, isAdmin } = await requireEventViewer();

  if (!UUID.test(id)) notFound();

  const { data } = await supabase
    .from("events")
    .select(eventDetailSelect({ showCosts }))
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const event = data as unknown as EventDetailQueryRow | null;

  // Event terhapus, dan event di luar region/distributor akun distributor
  // (lapis kedua selain RLS), diperlakukan sama dengan id yang tidak ada.
  if (!event || !canViewEvent(event, viewer)) notFound();

  const { region, distributor, costs, brands, campaigns, samplings, creator, updater, ...e } = event;
  const regionName = region?.name ?? null;
  const distributorName = distributor?.name ?? null;
  const cost = costs ?? null;
  const vendorName = cost?.vendor?.name ?? null;
  const creatorName = creator?.full_name;
  const updaterName = updater?.full_name;
  const { fiscalYear, quarter } = eventFiscalPeriod(e.start_date);
  const today = todayInJakarta();
  const actualBudget = cost?.actual_budget == null ? null : Number(cost.actual_budget);
  const hasRealization = e.actual_participants !== null || e.actual_sales !== null || actualBudget !== null;

  const linkedBrands = brands
    .filter((b) => !b.deleted_at)
    .map((b) => ({ id: b.brand_id, name: b.brand?.name ?? b.brand_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const samplingItems: EventSamplingItem[] = samplings
    .filter((s) => !s.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .map((s) => ({
      id: s.id,
      product_name: s.product_name,
      quantity: Number(s.quantity),
      unit: s.unit,
      // Kunci nilai tidak dikirim sama sekali ke browser distributor.
      ...(showCosts && { value: Number(s.cost?.value ?? 0) }),
    }));
  const linkedCampaigns = campaigns
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Nomor/judul/status terkini lewat event_campaign_refs (migrasi 056/059),
  // karena RLS campaigns tidak mengizinkan semua pembaca melihat SKP ini.
  // SKP yang dihapus permanen (campaign_id null) memakai snapshot.
  const campaignIds = linkedCampaigns.flatMap((c) => (c.campaign_id ? [c.campaign_id] : []));
  const isDistributor = viewer.role === "distributor";
  const [{ data: refs }, { data: readableCampaigns }, formOptions, { data: photoRows }] = await Promise.all([
    campaignIds.length ? supabase.rpc("event_campaign_refs", { p_ids: campaignIds }) : Promise.resolve({ data: [] }),
    // Distributor hanya mendapat link ke SKP yang bisa dibukanya: terbaca
    // lewat RLS campaigns dan milik distributornya (atau belum ditetapkan).
    isDistributor && campaignIds.length
      ? supabase.from("campaigns").select("id, distributor_id").in("id", campaignIds)
      : Promise.resolve({ data: null }),
    canManage && cost
      ? loadEventFormOptions(supabase, {
          region: regionName ? { id: e.region_id, name: regionName } : null,
          distributor: e.distributor_id && distributorName ? { id: e.distributor_id, name: distributorName } : null,
          vendor: cost.vendor_id && vendorName ? { id: cost.vendor_id, name: vendorName } : null,
          brands: linkedBrands,
        })
      : null,
    // RLS event_photos mengikuti events, termasuk untuk distributor.
    supabase
      .from("event_photos")
      .select("id, path")
      .eq("event_id", e.id)
      .is("deleted_at", null)
      .order("created_at"),
  ]);
  // Signed URL dengan client milik user: storage policy event-photos
  // (migrasi 060) memeriksa aturan baca event yang sama.
  const photoUrls = await signPosmPhotos(
    supabase,
    (photoRows ?? []).map((p) => p.path),
    EVENT_PHOTO_BUCKET
  );
  const photos = (photoRows ?? []).map((p) => ({ id: p.id, url: photoUrls.get(p.path) ?? null }));
  const refById = new Map((refs ?? []).map((r) => [r.id, r]));
  const openableIds = isDistributor
    ? new Set(
        (readableCampaigns ?? [])
          .filter((c) => isDistributorAllowedOnCampaign(c.distributor_id, viewer.distributor_id))
          .map((c) => c.id)
      )
    : null;
  const skps = linkedCampaigns.map((c) => {
    const ref = c.campaign_id ? refById.get(c.campaign_id) : undefined;
    return {
      id: c.campaign_id,
      openable: !!c.campaign_id && (openableIds?.has(c.campaign_id) ?? true),
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
            {eventNeedsUpdate(e, today) && <NeedsUpdateBadge />}
            {eventLacksPhoto(e, photos.length) && <NoPhotoBadge />}
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
            today={today}
            status={{
              id: e.id,
              status: e.status,
              start_date: e.start_date,
              actual_participants: e.actual_participants,
              actual_sales: e.actual_sales === null ? null : Number(e.actual_sales),
              actual_budget: actualBudget,
              cancel_reason: e.cancel_reason,
            }}
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
        <h2 className="mb-4 text-sm font-semibold text-slate-300">Detail</h2>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Jenis">{e.event_type}</Field>
          <Field label="Tanggal">{formatEventDateRange(e.start_date, e.end_date)}</Field>
          <Field label="Region">{regionName ?? "—"}</Field>
          <Field label="Lokasi / Outlet">{e.location}</Field>
          <Field label="PIC">{e.pic_name}</Field>
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/8 bg-white/2 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-300">Rencana</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="Target Peserta">
              <span className="tabular-nums">{e.target_participants.toLocaleString("id-ID")}</span>
            </Field>
            <Field label="Target Sales">
              <span className="tabular-nums">{formatIDR(Number(e.target_sales))}</span>
            </Field>
            {showCosts && (
              <>
                <Field label="Rencana Budget Event">
                  <span className="tabular-nums">{cost ? formatIDR(Number(cost.planned_budget)) : "—"}</span>
                </Field>
                <Field label="Rencana Budget Sample">
                  <span className="tabular-nums">{cost ? formatIDR(Number(cost.planned_sample_budget)) : "—"}</span>
                </Field>
              </>
            )}
          </dl>
        </section>

        <section className="rounded-xl border border-white/8 bg-white/2 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-300">Realisasi</h2>
          {/* Setelah koreksi ke Rencana, realisasi lama tetap tersimpan tetapi tidak dihitung. */}
          {e.status === "rencana" && hasRealization && (
            <p className="-mt-2 mb-4 text-xs text-slate-500">
              Nilai di bawah tersimpan dari status sebelumnya dan tidak dihitung sebagai aktual.
            </p>
          )}
          <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-4", e.status === "rencana" && "opacity-60")}>
            <Field label="Peserta Aktual">
              <span className="tabular-nums">
                {e.actual_participants === null ? "—" : e.actual_participants.toLocaleString("id-ID")}
              </span>
            </Field>
            <Field label="Hasil Sales">
              <span className="tabular-nums">{e.actual_sales === null ? "—" : formatIDR(Number(e.actual_sales))}</span>
            </Field>
            {showCosts && (
              <Field label="Realisasi Budget Event">
                <span className="tabular-nums">{actualBudget === null ? "—" : formatIDR(actualBudget)}</span>
              </Field>
            )}
            {(e.status === "batal" || e.cancel_reason) && (
              <Field label="Alasan Batal" className="col-span-2">
                {e.cancel_reason ? <span className="whitespace-pre-line">{e.cancel_reason}</span> : "—"}
              </Field>
            )}
          </dl>
        </section>
      </div>

      {/* Boleh kosong, termasuk pada event Terlaksana. */}
      <EventSamplingSection
        eventId={e.id}
        samplings={samplingItems}
        plannedSampleBudget={showCosts ? Number(cost?.planned_sample_budget ?? 0) : null}
        canManage={canManage}
      />

      <EventPhotoGallery eventId={e.id} eventName={e.name} photos={photos} canManage={canManage} />

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
          {showCosts && <Field label="Vendor Penyelenggara">{vendorName ?? "—"}</Field>}
          <Field label="SKP Terkait" className="sm:col-span-2 lg:col-span-4">
            {skps.length ? (
              <ul className="space-y-1.5">
                {skps.map((s, i) => (
                  <li key={s.id ?? `deleted-${i}`} className="flex flex-wrap items-center gap-2">
                    {s.id && s.openable ? (
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

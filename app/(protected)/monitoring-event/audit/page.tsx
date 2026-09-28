import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  EVENT_AUDIT_FIELD_LABELS,
  EVENT_AUDIT_TABLE_LABELS,
  EVENT_AUDIT_TABLES,
  formatEventAuditValue,
  parseEventAuditFilters,
  type EventAuditFilters,
  type EventAuditTable,
} from "@/lib/event";
import {
  auditChanges,
  auditFiltersQuery,
  formatAuditTimestamp,
  POSM_AUDIT_ACTION_LABELS,
  POSM_AUDIT_ACTIONS,
  POSM_AUDIT_PAGE_SIZE,
} from "@/lib/posm";
import type { PosmAuditAction, PosmAuditLogRow } from "@/types/database";
import { requirePosmViewer } from "../../monitoring-posm/viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE_PATH = "/monitoring-event/audit";

const ACTION_BADGE: Record<PosmAuditAction, "default" | "secondary" | "destructive"> = {
  insert: "default",
  update: "secondary",
  soft_delete: "destructive",
};

function pageHref(filters: EventAuditFilters, page: number) {
  const qs = auditFiltersQuery({ ...filters, page });
  return `${BASE_PATH}${qs ? `?${qs}` : ""}`;
}

function recordHref(recordId: string) {
  return `${BASE_PATH}?${auditFiltersQuery({ record: recordId })}`;
}

export default async function EventAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, isAdmin } = await requirePosmViewer();
  // Sama dengan RLS posm_audit_log: hanya admin/superadmin.
  if (!isAdmin) redirect("/monitoring-event");

  const filters = parseEventAuditFilters(await searchParams);

  // Baris event_costs memakai record_id = event_id, jadi filter record
  // sekaligus mencakup perubahan biaya event tersebut.
  let query = supabase
    .from("posm_audit_log")
    .select("id, table_name, record_id, action, old_data, new_data, changed_by, changed_at", { count: "exact" })
    .in("table_name", filters.table ? [filters.table] : [...EVENT_AUDIT_TABLES]);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actor) query = query.eq("changed_by", filters.actor);
  if (filters.record) query = query.eq("record_id", filters.record);
  if (filters.from) query = query.gte("changed_at", `${filters.from}T00:00:00+07:00`);
  if (filters.to) query = query.lte("changed_at", `${filters.to}T23:59:59.999+07:00`);

  const offset = (filters.page - 1) * POSM_AUDIT_PAGE_SIZE;
  const [{ data: logs, count }, { data: users }, { data: regions }, { data: distributors }, { data: vendors }] =
    await Promise.all([
      query.order("changed_at", { ascending: false }).range(offset, offset + POSM_AUDIT_PAGE_SIZE - 1),
      supabase.from("users").select("id, full_name, role").order("full_name"),
      supabase.from("regions").select("id, name"),
      supabase.from("distributors").select("id, name"),
      supabase.from("vendors").select("id, name"),
    ]);

  const entries = (logs ?? []) as PosmAuditLogRow[];

  // Nama event untuk label record, termasuk event yang sudah dihapus
  // (policy select events tidak menyaring deleted_at).
  const eventIds = new Set(entries.map((e) => e.record_id));
  if (filters.record) eventIds.add(filters.record);
  const { data: events } = eventIds.size
    ? await supabase.from("events").select("id, name, deleted_at").in("id", [...eventIds])
    : { data: [] };

  const names = new Map<string, string>([
    ...(regions ?? []).map((r) => [r.id, r.name] as const),
    ...(distributors ?? []).map((d) => [d.id, d.name] as const),
    ...(vendors ?? []).map((v) => [v.id, v.name] as const),
    ...(events ?? []).map((ev) => [ev.id, ev.deleted_at ? `${ev.name} (dihapus)` : ev.name] as const),
  ]);
  const userNames = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / POSM_AUDIT_PAGE_SIZE));
  const hasFilter = auditFiltersQuery({ ...filters, page: 1 }) !== "";
  const recordLabel = filters.record ? names.get(filters.record) ?? filters.record : null;

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-event"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring Event
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Audit Log Event</h1>
        <p className="text-slate-400 text-sm">
          Semua perubahan event dan biayanya, termasuk event yang sudah dihapus
        </p>
      </div>

      {recordLabel && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-slate-300">
            <History className="h-4 w-4 text-emerald-400" />
            Riwayat perubahan: <span className="font-medium text-slate-100">{recordLabel}</span>
          </span>
          <Link href={BASE_PATH} className="text-slate-400 hover:text-slate-200">
            Tampilkan semua
          </Link>
        </div>
      )}

      <form
        key={auditFiltersQuery({ ...filters, page: 1 })}
        method="get"
        className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-3 xl:grid-cols-6 xl:items-end"
      >
        {filters.record && <input type="hidden" name="record" value={filters.record} />}
        <div className="space-y-1.5">
          <Label>Dari tanggal</Label>
          <DatePicker name="from" defaultValue={filters.from} placeholder="Awal" />
        </div>
        <div className="space-y-1.5">
          <Label>Sampai tanggal</Label>
          <DatePicker name="to" defaultValue={filters.to} placeholder="Akhir" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-table">Data</Label>
          <Select id="f-table" name="table" defaultValue={filters.table ?? ""}>
            <option value="">Semua data</option>
            {EVENT_AUDIT_TABLES.map((t) => (
              <option key={t} value={t}>
                {EVENT_AUDIT_TABLE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-action">Aksi</Label>
          <Select id="f-action" name="action" defaultValue={filters.action ?? ""}>
            <option value="">Semua aksi</option>
            {POSM_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {POSM_AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-actor">Pelaku</Label>
          <Select id="f-actor" name="actor" defaultValue={filters.actor ?? ""}>
            <option value="">Semua pelaku</option>
            {(users ?? []).filter((u) => u.role !== "distributor").map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1">
            Terapkan
          </Button>
          {hasFilter && (
            <Button asChild variant="outline">
              <Link href={BASE_PATH}>Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <p className="text-sm text-slate-400">{total.toLocaleString("id-ID")} perubahan</p>

      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((e) => {
            const changes = auditChanges(e.action, e.old_data, e.new_data).filter(
              // Kolom turunan/kunci yang tidak informatif di diff.
              (c) => c.field !== "fiscal_year" && c.field !== "quarter" && c.field !== "event_id"
            );
            const label = names.get(e.record_id) ?? String((e.new_data ?? e.old_data)?.name ?? e.record_id);
            return (
              <div key={e.id} className="rounded-xl border border-white/8 bg-white/2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge variant={ACTION_BADGE[e.action]}>{POSM_AUDIT_ACTION_LABELS[e.action]}</Badge>
                  <Badge variant="outline">
                    {EVENT_AUDIT_TABLE_LABELS[e.table_name as EventAuditTable] ?? e.table_name}
                  </Badge>
                  {filters.record === e.record_id ? (
                    <span className="text-slate-200">{label}</span>
                  ) : (
                    <Link
                      href={recordHref(e.record_id)}
                      className="text-slate-200 hover:text-emerald-300"
                      title="Lihat riwayat event ini"
                    >
                      {label}
                    </Link>
                  )}
                  <span className="ml-auto whitespace-nowrap text-xs text-slate-500">
                    {formatAuditTimestamp(e.changed_at)} •{" "}
                    <span className="text-slate-400">
                      {(e.changed_by && userNames.get(e.changed_by)) ?? "Sistem"}
                    </span>
                  </span>
                </div>

                {changes.length > 0 && (
                  <dl className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-white/5 pt-3 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
                    {changes.map((c) => (
                      <div key={c.field} className="contents">
                        <dt className="text-slate-500">{EVENT_AUDIT_FIELD_LABELS[c.field] ?? c.field}</dt>
                        <dd className="flex flex-wrap items-center gap-2 break-all">
                          {e.action !== "insert" && (
                            <>
                              <span className="text-rose-300/80 line-through decoration-rose-400/40">
                                {formatEventAuditValue(c.field, c.old, names)}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-600" />
                            </>
                          )}
                          <span className="text-emerald-300">{formatEventAuditValue(c.field, c.new, names)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/8 bg-white/2 py-12 text-center text-slate-500">
          {hasFilter ? "Tidak ada perubahan yang cocok dengan filter." : "Belum ada perubahan tercatat."}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
          <span>
            Halaman {filters.page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            {filters.page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(filters, filters.page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                  Sebelumnya
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft className="h-4 w-4" />
                Sebelumnya
              </Button>
            )}
            {filters.page < totalPages ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(filters, filters.page + 1)}>
                  Berikutnya
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Berikutnya
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  auditChanges,
  auditFiltersQuery,
  auditRecordLabel,
  formatAuditTimestamp,
  formatAuditValue,
  parseAuditFilters,
  POSM_AUDIT_ACTION_LABELS,
  POSM_AUDIT_ACTIONS,
  POSM_AUDIT_FIELD_LABELS,
  POSM_AUDIT_PAGE_SIZE,
  POSM_AUDIT_TABLE_LABELS,
  POSM_AUDIT_TABLES,
  type PosmAuditFilters,
  type PosmAuditTable,
} from "@/lib/posm";
import type { PosmAuditAction, PosmAuditLogRow } from "@/types/database";
import { requirePosmViewer } from "../viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ACTION_BADGE: Record<PosmAuditAction, "default" | "secondary" | "destructive"> = {
  insert: "default",
  update: "secondary",
  soft_delete: "destructive",
};

function pageHref(filters: PosmAuditFilters, page: number) {
  const qs = auditFiltersQuery({ ...filters, page });
  return `/monitoring-posm/audit${qs ? `?${qs}` : ""}`;
}

function recordHref(recordId: string) {
  return `/monitoring-posm/audit?${auditFiltersQuery({ record: recordId })}`;
}

export default async function PosmAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, isAdmin } = await requirePosmViewer();
  if (!isAdmin) redirect("/monitoring-posm");

  const filters = parseAuditFilters(await searchParams);

  let query = supabase
    .from("posm_audit_log")
    .select("id, table_name, record_id, action, old_data, new_data, changed_by, changed_at", { count: "exact" });
  if (filters.table) query = query.eq("table_name", filters.table);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actor) query = query.eq("changed_by", filters.actor);
  // Riwayat record mencakup turunannya: mutasi milik item dan penempatan milik asset.
  if (filters.record) {
    query = query.or(
      `record_id.eq.${filters.record},new_data->>item_id.eq.${filters.record},new_data->>asset_id.eq.${filters.record}`
    );
  }
  if (filters.from) query = query.gte("changed_at", `${filters.from}T00:00:00+07:00`);
  if (filters.to) query = query.lte("changed_at", `${filters.to}T23:59:59.999+07:00`);

  const offset = (filters.page - 1) * POSM_AUDIT_PAGE_SIZE;
  const [{ data: logs, count }, { data: users }, { data: brands }, { data: regions }, { data: distributors }] =
    await Promise.all([
      query.order("changed_at", { ascending: false }).range(offset, offset + POSM_AUDIT_PAGE_SIZE - 1),
      supabase.from("users").select("id, full_name, role").order("full_name"),
      supabase.from("brands").select("id, name"),
      supabase.from("regions").select("id, name"),
      supabase.from("distributors").select("id, name"),
    ]);

  const entries = (logs ?? []) as PosmAuditLogRow[];

  // Nama untuk id referensi, termasuk item/asset yang sudah dihapus.
  const idsOf = (field: string) => {
    const ids = new Set<string>();
    for (const e of entries) {
      for (const data of [e.old_data, e.new_data]) {
        const v = data?.[field];
        if (typeof v === "string") ids.add(v);
      }
    }
    return ids;
  };
  const itemIds = idsOf("item_id");
  const assetIds = idsOf("asset_id");
  if (filters.record) {
    itemIds.add(filters.record);
    assetIds.add(filters.record);
  }
  const campaignIds = [...idsOf("campaign_id")];

  const [{ data: items }, { data: assets }, { data: campaigns }] = await Promise.all([
    itemIds.size
      ? supabase.from("posm_items").select("id, code, name").in("id", [...itemIds])
      : Promise.resolve({ data: [] }),
    assetIds.size
      ? supabase.from("marketing_assets").select("id, code, name").in("id", [...assetIds])
      : Promise.resolve({ data: [] }),
    campaignIds.length
      ? supabase.rpc("posm_campaign_refs", { p_ids: campaignIds })
      : Promise.resolve({ data: [] }),
  ]);

  const names = new Map<string, string>([
    ...(brands ?? []).map((b) => [b.id, b.name] as const),
    ...(regions ?? []).map((r) => [r.id, r.name] as const),
    ...(distributors ?? []).map((d) => [d.id, d.name] as const),
    ...(items ?? []).map((i) => [i.id, `${i.code} — ${i.name}`] as const),
    ...(assets ?? []).map((a) => [a.id, `${a.code} — ${a.name}`] as const),
    ...(campaigns ?? []).map((c) => [c.id, c.skp_number ? `${c.skp_number} — ${c.name}` : c.name] as const),
  ]);
  const userNames = new Map((users ?? []).map((u) => [u.id, u.full_name]));

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / POSM_AUDIT_PAGE_SIZE));
  const hasFilter = auditFiltersQuery({ ...filters, page: 1 }) !== "";

  const recordEntry = filters.record ? entries.find((e) => e.record_id === filters.record) : undefined;
  const recordLabel = filters.record
    ? names.get(filters.record) ??
      (recordEntry
        ? auditRecordLabel(recordEntry.table_name, recordEntry.new_data ?? recordEntry.old_data ?? {}, names)
        : filters.record)
    : null;

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-posm?tab=posm"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring POSM
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Audit Log POSM & Asset</h1>
        <p className="text-slate-400 text-sm">
          Semua perubahan item POSM, mutasi, asset, dan penempatan, termasuk data yang sudah dihapus
        </p>
      </div>

      {recordLabel && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-slate-300">
            <History className="h-4 w-4 text-emerald-400" />
            Riwayat perubahan: <span className="font-medium text-slate-100">{recordLabel}</span>
          </span>
          <Link href="/monitoring-posm/audit" className="text-slate-400 hover:text-slate-200">
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
            {POSM_AUDIT_TABLES.map((t) => (
              <option key={t} value={t}>
                {POSM_AUDIT_TABLE_LABELS[t]}
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
              <Link href="/monitoring-posm/audit">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <p className="text-sm text-slate-400">{total.toLocaleString("id-ID")} perubahan</p>

      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((e) => {
            const changes = auditChanges(e.action, e.old_data, e.new_data);
            const label = auditRecordLabel(e.table_name, e.new_data ?? e.old_data ?? {}, names);
            return (
              <div key={e.id} className="rounded-xl border border-white/8 bg-white/2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <Badge variant={ACTION_BADGE[e.action]}>{POSM_AUDIT_ACTION_LABELS[e.action]}</Badge>
                  <Badge variant="outline">
                    {POSM_AUDIT_TABLE_LABELS[e.table_name as PosmAuditTable] ?? e.table_name}
                  </Badge>
                  {filters.record === e.record_id ? (
                    <span className="text-slate-200">{label}</span>
                  ) : (
                    <Link
                      href={recordHref(e.record_id)}
                      className="text-slate-200 hover:text-emerald-300"
                      title="Lihat riwayat record ini"
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
                        <dt className="text-slate-500">{POSM_AUDIT_FIELD_LABELS[c.field] ?? c.field}</dt>
                        <dd className="flex flex-wrap items-center gap-2 break-all">
                          {e.action !== "insert" && (
                            <>
                              <span className="text-rose-300/80 line-through decoration-rose-400/40">
                                {formatAuditValue(c.field, c.old, names)}
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-600" />
                            </>
                          )}
                          <span className="text-emerald-300">{formatAuditValue(c.field, c.new, names)}</span>
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

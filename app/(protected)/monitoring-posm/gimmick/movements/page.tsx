import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import { POSM_MOVEMENT_LABELS, POSM_MOVEMENTS_PAGE_SIZE } from "@/lib/posm";
import {
  distinctPrograms,
  formatPcsWithCartons,
  GIMMICK_DESTINATION_LABELS,
  GIMMICK_DESTINATIONS,
  GIMMICK_MOVEMENT_TYPES,
  gimmickMovementFiltersQuery,
  parseGimmickMovementFilters,
  programIlikePattern,
  type GimmickMovementFilters,
} from "@/lib/gimmick";
import type { PosmMovementType } from "@/types/database";
import { withCampaignRefs } from "../../campaign-refs";
import { MovementDestination } from "../../movement-destination";
import { requirePosmViewer } from "../../viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TYPE_BADGE: Record<PosmMovementType, "default" | "secondary" | "warning" | "outline"> = {
  opening: "secondary",
  in: "default",
  out: "outline",
  adjustment: "warning",
};

const BASE_PATH = "/monitoring-posm/gimmick/movements";

function pageHref(filters: GimmickMovementFilters, page: number) {
  const qs = gimmickMovementFiltersQuery({ ...filters, page });
  return `${BASE_PATH}${qs ? `?${qs}` : ""}`;
}

export default async function GimmickMovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, canManage } = await requirePosmViewer();

  // Data gimmick hanya untuk pemegang can_manage_posm() (RLS juga menolak).
  if (!canManage) redirect("/monitoring-posm");

  const filters = parseGimmickMovementFilters(await searchParams);

  // !inner agar filter program (kolom item) menyaring mutasi.
  let query = supabase
    .from("gimmick_movements")
    .select(
      "id, item_id, movement_date, type, quantity, unit_cost_snapshot, destination, recipient_name, notes, created_at, campaign_id, item:gimmick_items!inner(code, name, unit, pcs_per_carton, program), region:regions(name), distributor:distributors(name), creator:created_by(full_name)",
      { count: "exact" }
    )
    .is("deleted_at", null);
  if (filters.from) query = query.gte("movement_date", filters.from);
  if (filters.to) query = query.lte("movement_date", filters.to);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.destination) query = query.eq("destination", filters.destination);
  if (filters.item) query = query.eq("item_id", filters.item);
  if (filters.region) query = query.eq("region_id", filters.region);
  if (filters.distributor) query = query.eq("distributor_id", filters.distributor);
  if (filters.program) query = query.ilike("item.program", programIlikePattern(filters.program));

  const offset = (filters.page - 1) * POSM_MOVEMENTS_PAGE_SIZE;
  const [{ data: movements, count }, { data: items }, { data: regions }, { data: distributors }] =
    await Promise.all([
      query
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + POSM_MOVEMENTS_PAGE_SIZE - 1),
      supabase.from("gimmick_items").select("id, code, name, program").is("deleted_at", null).order("code"),
      supabase.from("regions").select("id, name").order("name"),
      supabase.from("distributors").select("id, name").order("name"),
    ]);

  // Label SKP lewat gimmick_campaign_refs (khusus can_manage_posm()).
  const rows = await withCampaignRefs(supabase, movements ?? [], "gimmick_campaign_refs");
  const programs = distinctPrograms(items ?? []);
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / POSM_MOVEMENTS_PAGE_SIZE));
  const hasFilter = gimmickMovementFiltersQuery({ ...filters, page: 1 }) !== "";

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-posm?tab=gimmick"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring Gimmick
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Daftar Mutasi Gimmick</h1>
        <p className="text-slate-400 text-sm">Semua mutasi stok gimmick lintas item</p>
      </div>

      <form
        key={gimmickMovementFiltersQuery({ ...filters, page: 1 })}
        method="get"
        className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-4 xl:grid-cols-5 xl:items-end"
      >
        <div className="space-y-1.5">
          <Label>Dari tanggal</Label>
          <DatePicker name="from" defaultValue={filters.from} placeholder="Awal" />
        </div>
        <div className="space-y-1.5">
          <Label>Sampai tanggal</Label>
          <DatePicker name="to" defaultValue={filters.to} placeholder="Akhir" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-type">Tipe</Label>
          <Select id="f-type" name="type" defaultValue={filters.type ?? ""}>
            <option value="">Semua tipe</option>
            {GIMMICK_MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {POSM_MOVEMENT_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-destination">Tujuan</Label>
          <Select id="f-destination" name="destination" defaultValue={filters.destination ?? ""}>
            <option value="">Semua tujuan</option>
            {GIMMICK_DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {GIMMICK_DESTINATION_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-program">Program</Label>
          <Select id="f-program" name="program" defaultValue={filters.program ?? ""}>
            <option value="">Semua program</option>
            {programs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-item">Item</Label>
          <Select id="f-item" name="item" defaultValue={filters.item ?? ""}>
            <option value="">Semua item</option>
            {(items ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-region">Region</Label>
          <Select id="f-region" name="region" defaultValue={filters.region ?? ""}>
            <option value="">Semua region</option>
            {(regions ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-distributor">Distributor</Label>
          <Select id="f-distributor" name="distributor" defaultValue={filters.distributor ?? ""}>
            <option value="">Semua distributor</option>
            {(distributors ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
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

      <p className="text-sm text-slate-400">{total.toLocaleString("id-ID")} mutasi</p>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Tanggal</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Nilai</TableHead>
              <TableHead>Tujuan</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Dicatat Oleh</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((m) => {
                const item = m.item as {
                  code: string;
                  name: string;
                  unit: string;
                  pcs_per_carton: number | null;
                  program: string | null;
                } | null;
                // Nilai transaksi = qty × harga snapshot (bukan harga master terkini).
                const value = m.quantity * Number(m.unit_cost_snapshot);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-slate-300">{formatDate(m.movement_date)}</TableCell>
                    <TableCell>
                      <Link href={`/monitoring-posm/gimmick/items/${m.item_id}`} className="group block">
                        <code className="text-xs text-slate-500">{item?.code}</code>
                        <p className="text-slate-200 group-hover:text-emerald-300">{item?.name ?? "—"}</p>
                        {item?.program && <p className="text-xs text-slate-500">{item.program}</p>}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={TYPE_BADGE[m.type]}>{POSM_MOVEMENT_LABELS[m.type]}</Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-right font-medium tabular-nums",
                        m.quantity > 0 ? "text-emerald-400" : "text-rose-400"
                      )}
                    >
                      {m.quantity > 0 ? "+" : ""}
                      {item ? formatPcsWithCartons(m.quantity, item.pcs_per_carton, item.unit) : m.quantity}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-right tabular-nums",
                        value < 0 ? "text-rose-400" : "text-slate-100"
                      )}
                    >
                      {formatIDR(value)}
                    </TableCell>
                    <TableCell>
                      <MovementDestination
                        destinationLabel={m.destination ? GIMMICK_DESTINATION_LABELS[m.destination] : null}
                        regionName={(m.region as { name: string } | null)?.name ?? null}
                        distributorName={(m.distributor as { name: string } | null)?.name ?? null}
                        recipientName={m.recipient_name}
                        campaignSkp={m.campaign_skp}
                        campaignName={m.campaign_name}
                      />
                    </TableCell>
                    <TableCell className="max-w-xs text-slate-400">{m.notes ?? "—"}</TableCell>
                    <TableCell className="text-slate-500">
                      {(m.creator as { full_name: string } | null)?.full_name ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                  {hasFilter ? "Tidak ada mutasi yang cocok dengan filter." : "Belum ada mutasi."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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

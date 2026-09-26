import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  monthDateBounds,
  movementFiltersQuery,
  parseRekapFilters,
  REKAP_MAX_MONTHS,
  type RekapFilters,
} from "@/lib/posm";
import { loadPosmOutRekap } from "@/lib/posm-rekap-data";
import { requirePosmViewer } from "../viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function todayInJakarta() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("id-ID", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatQty(qty: number) {
  return qty.toLocaleString("id-ID");
}

/** Tautan ke daftar mutasi Keluar dengan filter yang sama, untuk menelusuri angka rekap. */
function movementsHref({
  from,
  to,
  item,
  region,
}: {
  from: string;
  to: string;
  item?: string;
  region?: string | null;
}) {
  const { start, end } = monthDateBounds(from, to);
  const qs = movementFiltersQuery({ from: start, to: end, type: "out", item, region: region ?? undefined });
  return `/monitoring-posm/movements?${qs}`;
}

function hasCustomFilter(filters: RekapFilters, defaults: RekapFilters) {
  return (
    filters.from !== defaults.from || filters.to !== defaults.to || Boolean(filters.item || filters.brand)
  );
}

export default async function PosmRekapPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requirePosmViewer();
  const today = todayInJakarta();
  const filters = parseRekapFilters(await searchParams, today);

  const [rekap, { data: items }, { data: brands }] = await Promise.all([
    loadPosmOutRekap(supabase, filters),
    supabase.from("posm_items").select("id, code, name").is("deleted_at", null).order("code"),
    supabase.from("brands").select("id, name").order("name"),
  ]);

  const { months, rows, monthTotals, grandTotal } = rekap;
  const showReset = hasCustomFilter(filters, parseRekapFilters({}, today));

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
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Rekap POSM Keluar</h1>
        <p className="text-slate-400 text-sm">
          Total qty Keluar per item per region per bulan • {monthLabel(filters.from)} – {monthLabel(filters.to)}
        </p>
      </div>

      <form
        key={JSON.stringify(filters)}
        method="get"
        className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-5 md:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="f-from">Dari bulan</Label>
          <Input id="f-from" type="month" name="from" defaultValue={filters.from} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-to">Sampai bulan</Label>
          <Input id="f-to" type="month" name="to" defaultValue={filters.to} />
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
          <Label htmlFor="f-brand">Brand</Label>
          <Select id="f-brand" name="brand" defaultValue={filters.brand ?? ""}>
            <option value="">Semua brand</option>
            {(brands ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="submit" className="flex-1">
            Terapkan
          </Button>
          {showReset && (
            <Button asChild variant="outline">
              <Link href="/monitoring-posm/rekap">Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <p className="text-xs text-slate-500">
        Hanya mutasi Keluar yang dihitung (Saldo Awal, Masuk, dan Penyesuaian tidak termasuk). Rentang maksimum{" "}
        {REKAP_MAX_MONTHS} bulan. Klik angka untuk melihat mutasinya.
      </p>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Item</TableHead>
              <TableHead>Region</TableHead>
              {months.map((m) => (
                <TableHead key={m} className="text-right whitespace-nowrap">
                  {monthLabel(m)}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              <>
                {rows.map((r) => (
                  <TableRow key={`${r.item_id}|${r.region_id}`}>
                    <TableCell>
                      <Link href={`/monitoring-posm/items/${r.item_id}`} className="group block">
                        <code className="text-xs text-slate-500">{r.item_code}</code>
                        <p className="whitespace-nowrap text-slate-200 group-hover:text-emerald-300">
                          {r.item_name}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-300">{r.region_name ?? "—"}</TableCell>
                    {r.months.map((qty, i) => (
                      <TableCell key={months[i]} className="text-right tabular-nums">
                        {qty > 0 ? (
                          <Link
                            href={movementsHref({
                              from: months[i],
                              to: months[i],
                              item: r.item_id,
                              region: r.region_id,
                            })}
                            className="text-slate-200 hover:text-emerald-300 hover:underline"
                          >
                            {formatQty(qty)}
                          </Link>
                        ) : (
                          <span className="text-slate-600">–</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      <Link
                        href={movementsHref({ ...filters, item: r.item_id, region: r.region_id })}
                        className="text-slate-100 hover:text-emerald-300 hover:underline"
                      >
                        {formatQty(r.total)}
                      </Link>{" "}
                      <span className="text-xs font-normal text-slate-500">{r.unit}</span>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-white/8 bg-emerald-500/10 font-semibold hover:bg-emerald-500/10">
                  <TableCell colSpan={2} className="text-emerald-400">
                    Total
                  </TableCell>
                  {monthTotals.map((qty, i) => (
                    <TableCell
                      key={months[i]}
                      className={cn("text-right tabular-nums", qty > 0 ? "text-slate-100" : "text-slate-600")}
                    >
                      {qty > 0 ? formatQty(qty) : "–"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums text-slate-100">{formatQty(grandTotal)}</TableCell>
                </TableRow>
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={months.length + 3} className="text-center py-12 text-slate-500">
                  Tidak ada POSM keluar pada periode dan filter ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

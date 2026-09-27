import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
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
import { cn, formatIDR } from "@/lib/utils";
import { monthDateBounds, monthLabel, REKAP_MAX_MONTHS } from "@/lib/posm";
import {
  aggregateGimmickDestinationRekap,
  aggregateGimmickProgramRekap,
  aggregateGimmickRegionRekap,
  distinctPrograms,
  GIMMICK_DESTINATION_LABELS,
  gimmickExportHref,
  gimmickMovementFiltersQuery,
  gimmickRekapFiltersQuery,
  parseGimmickRekapFilters,
  type GimmickMovementFilters,
  type GimmickRekapFilters,
  type GimmickRekapMode,
} from "@/lib/gimmick";
import { loadGimmickOutMovements } from "@/lib/gimmick-rekap-data";
import { ExportExcelButton } from "../../export-excel-button";
import { requirePosmViewer } from "../../viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const BASE_PATH = "/monitoring-posm/gimmick/rekap";

function todayInJakarta() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function formatAmount(amount: number, mode: GimmickRekapMode) {
  return mode === "value" ? formatIDR(amount) : amount.toLocaleString("id-ID");
}

function rekapHref(filters: Partial<GimmickRekapFilters>) {
  const qs = gimmickRekapFiltersQuery(filters);
  return `${BASE_PATH}${qs ? `?${qs}` : ""}`;
}

/** Tautan ke daftar mutasi Keluar gimmick dengan filter yang sama, untuk menelusuri angka rekap. */
function movementsHref(
  months: { from: string; to: string },
  filters: Omit<Partial<GimmickMovementFilters>, "from" | "to" | "type">
) {
  const { start, end } = monthDateBounds(months.from, months.to);
  const qs = gimmickMovementFiltersQuery({ ...filters, from: start, to: end, type: "out" });
  return `/monitoring-posm/gimmick/movements?${qs}`;
}

type MatrixRow = { key: string; label: ReactNode; months: number[]; total: number; drill?: Partial<GimmickMovementFilters> };

/** Tabel baris × bulan dengan total baris dan kolom; angka bisa diklik ke daftar mutasi. */
function RekapMatrix({
  title,
  description,
  labelHeader,
  months,
  rows,
  monthTotals,
  grandTotal,
  filters,
}: {
  title: string;
  description: string;
  labelHeader: string;
  months: string[];
  rows: MatrixRow[];
  monthTotals: number[];
  grandTotal: number;
  filters: GimmickRekapFilters;
}) {
  const { mode } = filters;
  // Filter item/program aktif ikut diteruskan ke daftar mutasi.
  const base = { item: filters.item, program: filters.program };

  const cell = (amount: number, drill: Partial<GimmickMovementFilters> | undefined, range: { from: string; to: string }) => {
    if (amount <= 0) return <span className="text-slate-600">–</span>;
    if (!drill) return formatAmount(amount, mode);
    return (
      <Link
        href={movementsHref(range, { ...base, ...drill })}
        className="hover:text-emerald-300 hover:underline"
      >
        {formatAmount(amount, mode)}
      </Link>
    );
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <div className="rounded-xl border border-white/8 bg-white/2 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>{labelHeader}</TableHead>
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
                  <TableRow key={r.key}>
                    <TableCell>{r.label}</TableCell>
                    {r.months.map((amount, i) => (
                      <TableCell key={months[i]} className="whitespace-nowrap text-right tabular-nums text-slate-200">
                        {cell(amount, r.drill, { from: months[i], to: months[i] })}
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-100">
                      {cell(r.total, r.drill, filters)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-white/8 bg-emerald-500/10 font-semibold hover:bg-emerald-500/10">
                  <TableCell className="text-emerald-400">Total</TableCell>
                  {monthTotals.map((amount, i) => (
                    <TableCell
                      key={months[i]}
                      className={cn(
                        "whitespace-nowrap text-right tabular-nums",
                        amount > 0 ? "text-slate-100" : "text-slate-600"
                      )}
                    >
                      {amount > 0 ? formatAmount(amount, mode) : "–"}
                    </TableCell>
                  ))}
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-100">
                    {formatAmount(grandTotal, mode)}
                  </TableCell>
                </TableRow>
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={months.length + 2} className="text-center py-10 text-slate-500">
                  Tidak ada gimmick keluar pada periode dan filter ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export default async function GimmickRekapPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase, canManage } = await requirePosmViewer();

  // Data gimmick hanya untuk pemegang can_manage_posm() (RLS juga menolak).
  if (!canManage) redirect("/monitoring-posm");

  const today = todayInJakarta();
  const filters = parseGimmickRekapFilters(await searchParams, today);
  const { mode } = filters;

  const [{ months, movements }, { data: items }] = await Promise.all([
    loadGimmickOutMovements(supabase, filters),
    supabase.from("gimmick_items").select("id, code, name, program").is("deleted_at", null).order("code"),
  ]);

  const byRegion = aggregateGimmickRegionRekap(movements, months, mode);
  const byDestination = aggregateGimmickDestinationRekap(movements, months, mode);
  const byProgram = aggregateGimmickProgramRekap(movements, months, mode);

  const programs = distinctPrograms(items ?? []);
  const defaults = parseGimmickRekapFilters({}, today);
  const showReset =
    filters.from !== defaults.from || filters.to !== defaults.to || Boolean(filters.item || filters.program);
  const modeLabel = mode === "value" ? "nilai Rp (qty × harga snapshot)" : "qty (pcs)";

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
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Rekap Gimmick Keluar</h1>
        <p className="text-slate-400 text-sm">
          Total {modeLabel} per region, tujuan, dan program • {monthLabel(filters.from)} – {monthLabel(filters.to)}
        </p>
      </div>

      <form
        key={gimmickRekapFiltersQuery(filters)}
        method="get"
        className="grid grid-cols-2 gap-3 rounded-xl border border-white/8 bg-white/2 p-4 md:grid-cols-5 md:items-end"
      >
        {/* Mode ikut terkirim agar menerapkan filter tidak mereset toggle. */}
        {mode === "value" && <input type="hidden" name="mode" value="value" />}
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
        <div className="col-span-2 flex gap-2 md:col-span-1">
          <Button type="submit" className="flex-1">
            Terapkan
          </Button>
          {showReset && (
            <Button asChild variant="outline">
              <Link href={rekapHref({ mode })}>Reset</Link>
            </Button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Hanya mutasi Keluar yang dihitung (Saldo Awal, Masuk, dan Penyesuaian tidak termasuk). Rentang maksimum{" "}
          {REKAP_MAX_MONTHS} bulan. Klik angka untuk melihat mutasinya.
        </p>
        <div className="inline-flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Mode rekap">
          {(
            [
              ["qty", "Qty"],
              ["value", "Nilai Rp"],
            ] as const
          ).map(([value, label]) => (
            <Link
              key={value}
              href={rekapHref({ ...filters, mode: value })}
              aria-current={mode === value ? "true" : undefined}
              className={cn(
                "rounded-md px-3 py-1 text-sm",
                mode === value ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        <ExportExcelButton href={gimmickExportHref({ rekap: filters })} />
      </div>

      <RekapMatrix
        title="Keluar per Region"
        description="Item × region × bulan. Keluar tanpa region (mis. Internal) tidak termasuk di sini."
        labelHeader="Item / Region"
        months={months}
        filters={filters}
        monthTotals={byRegion.monthTotals}
        grandTotal={byRegion.grandTotal}
        rows={byRegion.rows.map((r) => ({
          key: `${r.item_id}|${r.region_id}`,
          months: r.months,
          total: r.total,
          drill: { item: r.item_id, region: r.region_id },
          label: (
            <Link href={`/monitoring-posm/gimmick/items/${r.item_id}`} className="group block">
              <code className="text-xs text-slate-500">{r.item_code}</code>
              <p className="whitespace-nowrap text-slate-200 group-hover:text-emerald-300">{r.item_name}</p>
              <p className="whitespace-nowrap text-xs text-slate-400">{r.region_name}</p>
            </Link>
          ),
        }))}
      />

      <RekapMatrix
        title="Keluar per Tujuan"
        description="Tujuan × bulan, termasuk Keluar tanpa region."
        labelHeader="Tujuan"
        months={months}
        filters={filters}
        monthTotals={byDestination.monthTotals}
        grandTotal={byDestination.grandTotal}
        rows={byDestination.rows.map((r) => ({
          key: r.destination,
          months: r.months,
          total: r.total,
          drill: { destination: r.destination },
          label: <span className="whitespace-nowrap text-slate-200">{GIMMICK_DESTINATION_LABELS[r.destination]}</span>,
        }))}
      />

      <RekapMatrix
        title="Keluar per Program"
        description="Program/periode × bulan. Item tanpa program digabung sebagai “Tanpa Program”."
        labelHeader="Program"
        months={months}
        filters={filters}
        monthTotals={byProgram.monthTotals}
        grandTotal={byProgram.grandTotal}
        rows={byProgram.rows.map((r) => ({
          key: r.program ?? "",
          months: r.months,
          total: r.total,
          // Daftar mutasi tidak bisa memfilter "tanpa program", jadi baris itu tanpa tautan.
          drill: r.program ? { program: r.program } : undefined,
          label: (
            <span className={cn("whitespace-nowrap", r.program ? "text-slate-200" : "italic text-slate-400")}>
              {r.label}
            </span>
          ),
        }))}
      />
    </div>
  );
}

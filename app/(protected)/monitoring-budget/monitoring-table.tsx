import type { ReactNode } from "react";
import Link from "next/link";
import { Sheet } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatIDR } from "@/lib/utils";
import { drilldownKey, REGION_CONTRIBUTIONS } from "@/lib/monitoring-budget";
import type {
  NasionalRegionSummary,
  MissingStartDateSummary,
  MonitoringAggregate,
  MonitoringMode,
  MonitoringRow,
  MonitoringTotals,
} from "@/lib/monitoring-budget";
import {
  MonitoringDrilldownCell,
  type MonitoringDrilldown,
} from "./monitoring-drilldown-cell";

const REGION_COUNT = REGION_CONTRIBUTIONS.length;

// 5 kolom angka per region — dipakai baik untuk Alokasi Budget by Region
// (target, %tetap × Budget kategori) maupun Realisasi By Region (actual,
// requested_budget SKP per region asli). keyPrefix membedakan React key
// antar 2 blok karena nama region-nya sama persis di kedua blok.
function RegionAmountCells({
  keyPrefix,
  amounts,
}: {
  keyPrefix: string;
  amounts: { name: string; amount: number }[];
}) {
  return (
    <>
      {amounts.map((a) => (
        <TableCell
          key={`${keyPrefix}-${a.name}`}
          className="text-right text-slate-300 whitespace-nowrap"
        >
          {formatIDR(a.amount)}
        </TableCell>
      ))}
    </>
  );
}

function VarianceCell({ value }: { value: number }) {
  return (
    <TableCell
      className={cn(
        "text-right font-medium whitespace-nowrap",
        value < 0 ? "text-rose-400" : "text-slate-200"
      )}
    >
      {formatIDR(value)}
    </TableCell>
  );
}

function CategoryRow({
  row,
  monthLabels,
  drilldown,
}: {
  row: MonitoringRow;
  monthLabels: [string, string, string];
  drilldown: MonitoringDrilldown;
}) {
  const categoryLabel = row.accountCode ? `${row.accountCode} ${row.name}` : row.name;
  return (
    <TableRow className="border-white/6 hover:bg-white/3 transition-colors">
      <TableCell className="text-slate-200 whitespace-nowrap">
        {row.accountCode ? (
          <>
            <span className="font-mono text-xs text-slate-400 mr-2">
              {row.accountCode}
            </span>
            {row.name}
          </>
        ) : (
          <span className="italic text-slate-400">{row.name}</span>
        )}
      </TableCell>
      <TableCell className="text-right text-slate-300 whitespace-nowrap">
        {formatIDR(row.budget)}
      </TableCell>
      {row.months.map((v, i) => (
        <TableCell key={i} className="text-right p-0">
          <MonitoringDrilldownCell
            value={v}
            categoryLabel={categoryLabel}
            monthLabel={monthLabels[i]}
            drilldown={drilldown}
            itemsKey={drilldownKey(row.categoryId, i)}
          />
        </TableCell>
      ))}
      <TableCell className="text-right text-slate-200 font-medium whitespace-nowrap">
        {formatIDR(row.total)}
      </TableCell>
      <VarianceCell value={row.variance} />
      <RegionAmountCells keyPrefix="alokasi" amounts={row.regionAllocations} />
      <RegionAmountCells keyPrefix="realisasi" amounts={row.regionActuals} />
    </TableRow>
  );
}

function TotalsRow({
  label,
  totals,
  grand = false,
}: {
  label: string;
  totals: MonitoringTotals;
  grand?: boolean;
}) {
  return (
    <TableRow
      className={cn(
        "border-white/8 hover:bg-transparent font-semibold",
        grand ? "bg-emerald-500/10" : "bg-white/5"
      )}
    >
      <TableCell
        className={grand ? "text-emerald-400" : "text-slate-100"}
      >
        {label}
      </TableCell>
      <TableCell className="text-right text-slate-100 whitespace-nowrap">
        {formatIDR(totals.budget)}
      </TableCell>
      {totals.months.map((v, i) => (
        <TableCell key={i} className="text-right text-slate-100 whitespace-nowrap">
          {formatIDR(v)}
        </TableCell>
      ))}
      <TableCell className="text-right text-slate-100 whitespace-nowrap">
        {formatIDR(totals.total)}
      </TableCell>
      <VarianceCell value={totals.variance} />
      <RegionAmountCells keyPrefix="alokasi" amounts={totals.regionAllocations} />
      <RegionAmountCells keyPrefix="realisasi" amounts={totals.regionActuals} />
    </TableRow>
  );
}

export function MonitoringTable({
  aggregate,
  mode,
  missingStartDate,
  nasionalRegion,
  periodSelector,
  modeToggle,
  drilldown,
  exportHref,
}: {
  aggregate: MonitoringAggregate;
  mode: MonitoringMode;
  missingStartDate: MissingStartDateSummary;
  nasionalRegion: NasionalRegionSummary;
  periodSelector: ReactNode;
  modeToggle: ReactNode;
  drilldown: MonitoringDrilldown;
  exportHref: string;
}) {
  const { fiscalYear, quarter, monthLabels, tpRows, cpRows, uncategorized } =
    aggregate;
  const periodLabel = `Q${quarter} FY${fiscalYear} • ${monthLabels[0]} – ${monthLabels[2]}`;
  const isEmpty =
    tpRows.length === 0 && cpRows.length === 0 && uncategorized === null;
  const modeLabel =
    mode === "realisasi"
      ? "Mode Realisasi (invoice)"
      : "Mode Komitmen (SKP disetujui)";
  const emptyStateLabel =
    mode === "realisasi"
      ? "Belum ada budget maupun realisasi invoice di kuartal ini."
      : "Belum ada budget maupun SKP komitmen di kuartal ini.";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">
            Monitoring Budget
          </h1>
          <p className="text-slate-400 text-sm">
            {periodLabel}
            <span className="text-slate-600"> • {modeLabel}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {modeToggle}
          {periodSelector}
          <Link
            href={exportHref}
            className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Sheet className="h-4 w-4" />
            Export Excel
          </Link>
        </div>
      </div>

      {mode === "komitmen" && missingStartDate.count > 0 && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/8 px-4 py-2.5 text-sm text-amber-300">
          {missingStartDate.count} SKP komitmen senilai{" "}
          {formatIDR(missingStartDate.total)} tidak punya tanggal mulai
          program, sehingga tidak masuk tabel di kuartal manapun.
        </div>
      )}

      {nasionalRegion.count > 0 && (
        <div className="rounded-md border border-sky-500/20 bg-sky-500/8 px-4 py-2.5 text-sm text-sky-300">
          {nasionalRegion.count} SKP komitmen senilai{" "}
          {formatIDR(nasionalRegion.total)} berregion &quot;National&quot; atau
          region lain di luar 5 wilayah tetap, dikelompokkan ke kolom region
          &quot;Nasional&quot;.
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-white/8 bg-white/3 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead rowSpan={2} className="text-slate-400 min-w-[220px] align-bottom">
                  Kategori
                </TableHead>
                <TableHead rowSpan={2} className="text-slate-400 text-right min-w-[140px] align-bottom">
                  Budget (IDR)
                </TableHead>
                {monthLabels.map((label) => (
                  <TableHead
                    key={label}
                    rowSpan={2}
                    className="text-slate-400 text-right min-w-[130px] align-bottom"
                  >
                    {label}
                  </TableHead>
                ))}
                <TableHead rowSpan={2} className="text-slate-400 text-right min-w-[140px] align-bottom">
                  Total Actual
                </TableHead>
                <TableHead rowSpan={2} className="text-slate-400 text-right min-w-[140px] align-bottom">
                  Variance
                </TableHead>
                <TableHead
                  colSpan={REGION_COUNT}
                  className="text-slate-400 text-center border-l border-white/8"
                >
                  Alokasi Budget by Region
                </TableHead>
                <TableHead
                  colSpan={REGION_COUNT}
                  className="text-slate-400 text-center border-l border-white/8"
                >
                  Realisasi By Region
                </TableHead>
              </TableRow>
              <TableRow className="border-white/8 hover:bg-transparent">
                {REGION_CONTRIBUTIONS.map((region) => (
                  <TableHead
                    key={`alokasi-${region.name}`}
                    className="text-slate-400 text-right min-w-[150px]"
                  >
                    {region.name}
                  </TableHead>
                ))}
                {REGION_CONTRIBUTIONS.map((region) => (
                  <TableHead
                    key={`realisasi-${region.name}`}
                    className="text-slate-400 text-right min-w-[150px]"
                  >
                    {region.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isEmpty ? (
                <TableRow>
                  <TableCell
                    colSpan={7 + REGION_COUNT * 2}
                    className="text-center text-slate-500 py-12"
                  >
                    {emptyStateLabel}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {tpRows.map((row) => (
                    <CategoryRow
                      key={row.categoryId}
                      row={row}
                      monthLabels={monthLabels}
                      drilldown={drilldown}
                    />
                  ))}
                  <TotalsRow label="Total TP" totals={aggregate.totalTP} />
                  {cpRows.map((row) => (
                    <CategoryRow
                      key={row.categoryId}
                      row={row}
                      monthLabels={monthLabels}
                      drilldown={drilldown}
                    />
                  ))}
                  <TotalsRow label="Total CP" totals={aggregate.totalCP} />
                  {uncategorized && (
                    <CategoryRow
                      row={uncategorized}
                      monthLabels={monthLabels}
                      drilldown={drilldown}
                    />
                  )}
                  <TotalsRow
                    label="Total TP CP"
                    totals={aggregate.grandTotal}
                    grand
                  />
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

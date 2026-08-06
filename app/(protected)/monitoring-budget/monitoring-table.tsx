import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatIDR } from "@/lib/utils";
import type {
  MonitoringAggregate,
  MonitoringRow,
  MonitoringTotals,
} from "@/lib/monitoring-budget";

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

function CategoryRow({ row }: { row: MonitoringRow }) {
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
        <TableCell key={i} className="text-right text-slate-300 whitespace-nowrap">
          {formatIDR(v)}
        </TableCell>
      ))}
      <TableCell className="text-right text-slate-200 font-medium whitespace-nowrap">
        {formatIDR(row.total)}
      </TableCell>
      <VarianceCell value={row.variance} />
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
    </TableRow>
  );
}

export function MonitoringTable({
  aggregate,
}: {
  aggregate: MonitoringAggregate;
}) {
  const { fiscalYear, quarter, monthLabels, tpRows, cpRows, uncategorized } =
    aggregate;
  const periodLabel = `Q${quarter} FY${fiscalYear} • ${monthLabels[0]} – ${monthLabels[2]}`;
  const isEmpty =
    tpRows.length === 0 && cpRows.length === 0 && uncategorized === null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">
          Monitoring Budget
        </h1>
        <p className="text-slate-400 text-sm">
          {periodLabel}
          <span className="text-slate-600"> • Mode Komitmen (SKP disetujui)</span>
        </p>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/8 bg-white/3 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-slate-400 min-w-[220px]">
                  Kategori
                </TableHead>
                <TableHead className="text-slate-400 text-right min-w-[140px]">
                  Budget (IDR)
                </TableHead>
                {monthLabels.map((label) => (
                  <TableHead
                    key={label}
                    className="text-slate-400 text-right min-w-[130px]"
                  >
                    {label}
                  </TableHead>
                ))}
                <TableHead className="text-slate-400 text-right min-w-[140px]">
                  Total Actual
                </TableHead>
                <TableHead className="text-slate-400 text-right min-w-[140px]">
                  Variance
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isEmpty ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-slate-500 py-12"
                  >
                    Belum ada budget maupun SKP komitmen di kuartal ini.
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {tpRows.map((row) => (
                    <CategoryRow key={row.categoryId} row={row} />
                  ))}
                  <TotalsRow label="Total TP" totals={aggregate.totalTP} />
                  {cpRows.map((row) => (
                    <CategoryRow key={row.categoryId} row={row} />
                  ))}
                  <TotalsRow label="Total CP" totals={aggregate.totalCP} />
                  {uncategorized && <CategoryRow row={uncategorized} />}
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

"use client";

import { Fragment, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AssetStockCounts, AssetStockSummary } from "@/lib/posm";
import { cn, formatIDR } from "@/lib/utils";

function CountCells({ counts }: { counts: AssetStockCounts }) {
  const n = (v: number) => v.toLocaleString("id-ID");
  return (
    <>
      <TableCell className="text-right tabular-nums">{n(counts.total)}</TableCell>
      <TableCell className="text-right tabular-nums">{n(counts.warehouse)}</TableCell>
      <TableCell className="text-right tabular-nums">{n(counts.placed)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", counts.damaged > 0 && "text-amber-400")}>
        {n(counts.damaged)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", counts.lost > 0 && "text-rose-400")}>
        {n(counts.lost)}
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatIDR(counts.value)}</TableCell>
    </>
  );
}

/** Tabel Ringkasan Stok: baris Jenis yang bisa dibuka menjadi baris per Nama. */
export function AssetStockSummaryTable({ summary }: { summary: AssetStockSummary }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(typeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-white/8 hover:bg-transparent">
            <TableHead>Jenis / Nama Asset</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Di Gudang Pusat</TableHead>
            <TableHead className="text-right">Ditempatkan</TableHead>
            <TableHead className="text-right">Rusak</TableHead>
            <TableHead className="text-right">Hilang</TableHead>
            <TableHead className="text-right">Nilai Perolehan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.groups.length > 0 ? (
            summary.groups.map((group) => {
              const isOpen = expanded.has(group.typeId);
              return (
                <Fragment key={group.typeId}>
                  <TableRow className="font-medium text-slate-100">
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => toggle(group.typeId)}
                        aria-expanded={isOpen}
                        className="flex items-center gap-1.5 hover:text-emerald-400"
                      >
                        <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                        {group.typeName}
                        <span className="text-xs font-normal text-slate-500">({group.names.length} nama)</span>
                      </button>
                    </TableCell>
                    <CountCells counts={group.counts} />
                  </TableRow>
                  {isOpen &&
                    group.names.map((row) => (
                      <TableRow key={row.name} className="text-slate-400">
                        <TableCell className="pl-11">{row.name}</TableCell>
                        <CountCells counts={row.counts} />
                      </TableRow>
                    ))}
                </Fragment>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                Tidak ada asset yang cocok dengan filter.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {summary.groups.length > 0 && (
          <TableFooter>
            <TableRow className="font-semibold text-slate-100">
              <TableCell>Total</TableCell>
              <CountCells counts={summary.total} />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

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
import type { AssetStockColumn, AssetStockCounts, AssetStockSummary } from "@/lib/posm";
import { cn, formatIDR } from "@/lib/utils";

/** Baris ringkasan yang diklik: kosong = total, jenis saja, atau jenis + nama. */
export type AssetStockCell = { typeId?: string; name?: string };

/** Tautan angka ringkasan ke Daftar Unit yang sudah tersaring. */
export type AssetStockLinks = {
  href: (cell: AssetStockCell, column: AssetStockColumn) => string;
  open: (cell: AssetStockCell, column: AssetStockColumn) => void;
};

const COUNT_COLUMNS: { column: AssetStockColumn; label: string; tone?: string }[] = [
  { column: "total", label: "Total" },
  { column: "warehouse", label: "Di Gudang Pusat" },
  { column: "placed", label: "Ditempatkan" },
  { column: "damaged", label: "Rusak", tone: "text-amber-400" },
  { column: "lost", label: "Hilang", tone: "text-rose-400" },
];

function CountCells({
  counts,
  cell,
  links,
}: {
  counts: AssetStockCounts;
  cell: AssetStockCell;
  links: AssetStockLinks;
}) {
  return (
    <>
      {COUNT_COLUMNS.map(({ column, label, tone }) => {
        const value = counts[column];
        const text = value.toLocaleString("id-ID");
        return (
          <TableCell key={column} className={cn("text-right tabular-nums", value > 0 && tone)}>
            {/* Angka 0 tidak ditautkan: daftarnya pasti kosong. */}
            {value > 0 ? (
              <a
                href={links.href(cell, column)}
                onClick={(e) => {
                  // Tetap tautan biasa untuk buka di tab baru; klik biasa pindah tampilan di tempat.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  links.open(cell, column);
                }}
                title={`Lihat unit: ${label}`}
                className="hover:text-emerald-400 hover:underline"
              >
                {text}
              </a>
            ) : (
              text
            )}
          </TableCell>
        );
      })}
      <TableCell className="text-right tabular-nums whitespace-nowrap">{formatIDR(counts.value)}</TableCell>
    </>
  );
}

/** Tabel Ringkasan Stok: baris Jenis yang bisa dibuka menjadi baris per Nama. */
export function AssetStockSummaryTable({ summary, links }: { summary: AssetStockSummary; links: AssetStockLinks }) {
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
            {COUNT_COLUMNS.map(({ column, label }) => (
              <TableHead key={column} className="text-right">
                {label}
              </TableHead>
            ))}
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
                    <CountCells counts={group.counts} cell={{ typeId: group.typeId }} links={links} />
                  </TableRow>
                  {isOpen &&
                    group.names.map((row) => (
                      <TableRow key={row.name} className="text-slate-400">
                        <TableCell className="pl-11">{row.name}</TableCell>
                        <CountCells counts={row.counts} cell={{ typeId: group.typeId, name: row.name }} links={links} />
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
              <CountCells counts={summary.total} cell={{}} links={links} />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

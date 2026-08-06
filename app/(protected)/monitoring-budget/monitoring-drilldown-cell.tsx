"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import type {
  DrilldownCampaignItem,
  DrilldownInvoiceItem,
  MonitoringDrilldown,
} from "@/lib/monitoring-budget";

export type { MonitoringDrilldown };

function KomitmenList({ items }: { items: DrilldownCampaignItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/8 text-left text-xs text-slate-500">
          <th className="px-3 py-2 font-medium">Nomor SKP</th>
          <th className="px-3 py-2 font-medium">Nama</th>
          <th className="px-3 py-2 font-medium">Brand</th>
          <th className="px-3 py-2 font-medium text-right">Nilai</th>
          <th className="px-3 py-2 font-medium">Tgl Mulai</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-white/6 last:border-b-0">
            <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
              {item.skpNumber ?? "—"}
            </td>
            <td className="px-3 py-2 text-slate-200">{item.name}</td>
            <td className="px-3 py-2 text-slate-400">{item.brandName ?? "—"}</td>
            <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">
              {formatIDR(item.requestedBudget)}
            </td>
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
              {formatDate(item.startDate)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RealisasiList({ items }: { items: DrilldownInvoiceItem[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/8 text-left text-xs text-slate-500">
          <th className="px-3 py-2 font-medium">Nomor Invoice</th>
          <th className="px-3 py-2 font-medium">SKP Induk</th>
          <th className="px-3 py-2 font-medium text-right">Nilai</th>
          <th className="px-3 py-2 font-medium">Tgl Realisasi</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-b border-white/6 last:border-b-0">
            <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
              {item.invoiceNumber}
            </td>
            <td className="px-3 py-2 text-slate-200">{item.campaignName}</td>
            <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">
              {formatIDR(item.amount)}
            </td>
            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
              {formatDate(item.realizationDate)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Sel bulan×kategori yang bisa diklik untuk melihat daftar SKP/invoice
// pembentuk angkanya. Sel bernilai nol tidak dibuat klikabel (tidak ada
// item untuk didrilldown) — dirender sebagai teks biasa, konsisten dengan
// subtotal dan kolom Budget.
export function MonitoringDrilldownCell({
  value,
  categoryLabel,
  monthLabel,
  drilldown,
  itemsKey,
}: {
  value: number;
  categoryLabel: string;
  monthLabel: string;
  drilldown: MonitoringDrilldown;
  itemsKey: string;
}) {
  if (value === 0) {
    return (
      <span className="block px-4 py-2 text-right text-slate-300 whitespace-nowrap">
        {formatIDR(value)}
      </span>
    );
  }

  const description =
    drilldown.mode === "realisasi"
      ? "Daftar invoice realisasi yang membentuk angka ini."
      : "Daftar SKP disetujui yang membentuk angka ini.";

  if (drilldown.mode === "komitmen") {
    const items = drilldown.data[itemsKey] ?? [];
    const total = items.reduce((s, i) => s + i.requestedBudget, 0);
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className={cn(
              "block w-full px-4 py-2 text-right text-slate-300 whitespace-nowrap",
              "hover:bg-white/5 hover:text-emerald-300 transition-colors cursor-pointer"
            )}
          >
            {formatIDR(value)}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {categoryLabel} — {monthLabel}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-white/8 overflow-hidden overflow-x-auto max-h-[60vh] overflow-y-auto">
            {items.length > 0 ? (
              <KomitmenList items={items} />
            ) : (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Tidak ada data.
              </p>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-slate-400">Total</span>
            <span className="font-semibold text-slate-100">{formatIDR(total)}</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const items = drilldown.data[itemsKey] ?? [];
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "block w-full px-4 py-2 text-right text-slate-300 whitespace-nowrap",
            "hover:bg-white/5 hover:text-emerald-300 transition-colors cursor-pointer"
          )}
        >
          {formatIDR(value)}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {categoryLabel} — {monthLabel}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-white/8 overflow-hidden overflow-x-auto max-h-[60vh] overflow-y-auto">
          {items.length > 0 ? (
            <RealisasiList items={items} />
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Tidak ada data.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-slate-400">Total</span>
          <span className="font-semibold text-slate-100">{formatIDR(total)}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

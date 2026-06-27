"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Sheet, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIDR, formatDate } from "@/lib/utils";
import { getStatusConfig } from "@/lib/campaign-status";
import type { UserRole, CampaignStatus } from "@/types/database";
import type { RekapCampaign } from "./page";

const ALL_STATUSES: { value: CampaignStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Diajukan" },
  { value: "approved_l1", label: "Disetujui L1" },
  { value: "approved_l2", label: "Disetujui L2" },
  { value: "approved_l3", label: "Disetujui L3" },
  { value: "approved_l4", label: "Disetujui L4" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
  { value: "ongoing", label: "Berjalan" },
  { value: "claim_submitted", label: "Klaim Diajukan" },
  { value: "paid", label: "Paid" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

interface Option {
  id: string;
  name: string;
}

interface RekapFilters {
  status: CampaignStatus[];
  brand: string;
  region: string;
  department: string;
  action_approval: string;
  date_from: string;
  date_to: string;
}

interface RekapClientProps {
  campaigns: RekapCampaign[];
  departments: Option[];
  brands: Option[];
  regions: Option[];
  actionApprovals: Option[];
  userRole: UserRole;
  filters: RekapFilters;
  isDistributor?: boolean;
  receiptedCampaignIds?: string[];
}

const FILTER_KEYS = ["status", "brand", "region", "department", "action_approval", "date_from", "date_to"];
const PAGE_SIZE = 20;

function StatusMultiSelect({
  selected,
  onChange,
}: {
  selected: CampaignStatus[];
  onChange: (values: CampaignStatus[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(value: CampaignStatus) {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const label =
    selected.length === 0
      ? "Semua Status"
      : selected.length === 1
      ? ALL_STATUSES.find((s) => s.value === selected[0])?.label ?? selected[0]
      : `${selected.length} status dipilih`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-100 hover:bg-white/8 transition-colors min-w-[160px]"
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-52 rounded-md border border-white/10 bg-slate-900 shadow-lg py-1">
          {ALL_STATUSES.map((s) => (
            <label
              key={s.value}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(s.value)}
                onChange={() => toggle(s.value)}
                className="accent-emerald-500"
              />
              {s.label}
            </label>
          ))}
          {selected.length > 0 && (
            <div className="border-t border-white/8 mt-1 pt-1 px-3 pb-1">
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                Hapus pilihan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RekapClient({
  campaigns,
  departments,
  brands,
  regions,
  actionApprovals,
  userRole,
  filters,
  isDistributor = false,
  receiptedCampaignIds = [],
}: RekapClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [currentPage, setCurrentPage] = useState(1);

  const receiptedSet = new Set(receiptedCampaignIds);
  const colSpan = isDistributor ? 14 : 19;
  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const paginated = campaigns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setCurrentPage(1); }, [campaigns.length]);

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function updateStatuses(values: CampaignStatus[]) {
    const next = new URLSearchParams(searchParams.toString());
    if (values.length === 0) {
      next.delete("status");
    } else {
      next.set("status", values.join(","));
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const hasActiveFilters = FILTER_KEYS.some((k) => searchParams.get(k));

  function clearFilters() {
    router.replace(pathname, { scroll: false });
  }

  const exportParams = new URLSearchParams();
  if (filters.status.length > 0) exportParams.set("status", filters.status.join(","));
  if (filters.brand) exportParams.set("brand", filters.brand);
  if (filters.region) exportParams.set("region", filters.region);
  if (filters.department) exportParams.set("department", filters.department);
  if (filters.action_approval) exportParams.set("action_approval", filters.action_approval);
  if (filters.date_from) exportParams.set("date_from", filters.date_from);
  if (filters.date_to) exportParams.set("date_to", filters.date_to);
  const excelHref = `/api/export/excel?${exportParams.toString()}`;

  const totalBudget = campaigns.reduce((s, c) => s + c.requested_budget, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.actual_spent, 0);

  const paginationControls = totalPages > 1 ? (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        className="px-3 h-8 rounded-md border border-white/10 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        ‹ Prev
      </button>

      {Array.from({ length: totalPages }, (_, i) => i + 1)
        .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
        .reduce<(number | "…")[]>((acc, p, i, arr) => {
          if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
          acc.push(p);
          return acc;
        }, [])
        .map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-600">…</span>
          ) : (
            <button
              key={p}
              onClick={() => setCurrentPage(p as number)}
              className={`w-8 h-8 rounded-md text-xs transition-colors ${
                currentPage === p
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "border border-white/10 text-slate-400 hover:bg-white/5"
              }`}
            >
              {p}
            </button>
          )
        )}

      <button
        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
        disabled={currentPage === totalPages}
        className="px-3 h-8 rounded-md border border-white/10 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next ›
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Rekap SKP</h1>
          <p className="text-slate-400 text-sm">
            {campaigns.length} SKP ditemukan
            {totalPages > 1 && (
              <span className="text-slate-600"> • hal. {currentPage}/{totalPages}</span>
            )}
            <span className="text-slate-600"> • data per{" "}
              {new Date().toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {paginationControls}
          <Link
            href={excelHref}
            className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Sheet className="h-4 w-4" />
            Download Excel
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border border-white/8 bg-white/3 p-4">
        <div className="flex flex-wrap gap-2 items-center">
          {!isDistributor && (
            <>
              <StatusMultiSelect
                selected={filters.status}
                onChange={updateStatuses}
              />
              <Select
                value={filters.department}
                onChange={(e) => update("department", e.target.value)}
                className="w-44"
              >
                <option value="">Semua Dept.</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
              <Select
                value={filters.brand}
                onChange={(e) => update("brand", e.target.value)}
                className="w-44"
              >
                <option value="">Semua Brand</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
              <Select
                value={filters.region}
                onChange={(e) => update("region", e.target.value)}
                className="w-40"
              >
                <option value="">Semua Region</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
              <Select
                value={filters.action_approval}
                onChange={(e) => update("action_approval", e.target.value)}
                className="w-52"
              >
                <option value="">Semua AA</option>
                {actionApprovals.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">Dari</span>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => update("date_from", e.target.value)}
              className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 [color-scheme:dark]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">s.d.</span>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => update("date_to", e.target.value)}
              className="h-10 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 [color-scheme:dark]"
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 h-10 text-xs text-slate-400 hover:text-slate-200 border border-white/10 rounded-md hover:border-white/20 transition-colors"
            >
              <X className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Summary totals */}
      {campaigns.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-slate-400">
          <span>
            Total Budget:{" "}
            <span className="text-slate-200 font-medium">{formatIDR(totalBudget)}</span>
          </span>
          <span>
            Total Realisasi:{" "}
            <span className="text-slate-200 font-medium">{formatIDR(totalSpent)}</span>
          </span>
          <span>
            Sisa:{" "}
            <span className="text-slate-200 font-medium">
              {formatIDR(totalBudget - totalSpent)}
            </span>
          </span>
          <span>
            Serapan:{" "}
            <span className="text-slate-200 font-medium">
              {totalBudget > 0
                ? (() => {
                    const pct = (totalSpent / totalBudget) * 100;
                    return (pct > 0 && pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1)) + "%";
                  })()
                : "0%"}
            </span>
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-white/8 bg-white/3 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-slate-400 min-w-[120px]">No. SKP</TableHead>
                <TableHead className="text-slate-400 min-w-[200px]">Nama SKP</TableHead>
                <TableHead className="text-slate-400">Dept.</TableHead>
                {!isDistributor && <TableHead className="text-slate-400">Brand</TableHead>}
                <TableHead className="text-slate-400">Region</TableHead>
                <TableHead className="text-slate-400">Channel</TableHead>
                <TableHead className="text-slate-400 min-w-[130px]">Promo Cat.</TableHead>
                <TableHead className="text-slate-400">ID Store</TableHead>
                {!isDistributor && <TableHead className="text-slate-400 min-w-[160px]">AA</TableHead>}
                <TableHead className="text-slate-400 text-right">Budget (IDR)</TableHead>
                <TableHead className="text-slate-400 text-right">Sales Proj. (IDR)</TableHead>
                {!isDistributor && <TableHead className="text-slate-400 text-right">Cost Ratio</TableHead>}
                <TableHead className="text-slate-400 text-right">Realisasi (IDR)</TableHead>
                <TableHead className="text-slate-400 text-right">Serapan</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400 min-w-[130px]">Periode</TableHead>
                {!isDistributor && <TableHead className="text-slate-400">Jml Inv.</TableHead>}
                {!isDistributor && <TableHead className="text-slate-400 min-w-[110px]">Diajukan</TableHead>}
                <TableHead className="text-slate-400 min-w-[130px]">Status Penerimaan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colSpan}
                    className="text-center text-slate-500 py-12"
                  >
                    Tidak ada data SKP yang sesuai filter.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((c) => {
                  const pct =
                    c.requested_budget > 0
                      ? (c.actual_spent / c.requested_budget) * 100
                      : 0;
                  const statusCfg = getStatusConfig(c.status);
                  const isReceipted = receiptedSet.has(c.id);

                  return (
                    <TableRow
                      key={c.id}
                      className="border-white/6 hover:bg-white/3 transition-colors"
                    >
                      <TableCell className="text-slate-400 font-mono text-xs whitespace-nowrap">
                        {c.skp_number ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium text-slate-200">
                        {isDistributor && !isReceipted ? (
                          c.name
                        ) : (
                          <Link
                            href={`/campaigns/${c.id}`}
                            className="hover:text-emerald-400 transition-colors"
                          >
                            {c.name}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {c.department?.name ?? "—"}
                      </TableCell>
                      {!isDistributor && (
                        <TableCell className="text-slate-400">
                          {c.brand?.name ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-slate-400">
                        {c.region?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-slate-400">
                        {c.channel?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {c.promotion_category?.name ?? "—"}
                        {c.promotion_category?.account_code && (
                          <span className="block text-slate-600">
                            {c.promotion_category.account_code}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {c.store_id ?? <span className="text-slate-600">—</span>}
                      </TableCell>
                      {!isDistributor && (
                        <TableCell className="text-slate-400 text-xs">
                          {c.action_approval?.name ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-slate-300 font-mono text-xs">
                        {formatIDR(c.requested_budget)}
                      </TableCell>
                      <TableCell className="text-right text-slate-300 font-mono text-xs">
                        {c.sales_projection > 0 ? formatIDR(c.sales_projection) : <span className="text-slate-600">—</span>}
                      </TableCell>
                      {!isDistributor && (
                        <TableCell className="text-right font-mono text-xs">
                          {c.sales_projection > 0 ? (
                            <span className="text-sky-400">
                              {((c.requested_budget / c.sales_projection) * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-slate-300 font-mono text-xs">
                        {formatIDR(c.actual_spent)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            pct >= 100
                              ? "text-rose-400 font-medium text-xs"
                              : pct >= 80
                              ? "text-amber-400 font-medium text-xs"
                              : "text-emerald-400 text-xs"
                          }
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusCfg.className}`}
                        >
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {c.start_date ? formatDate(c.start_date) : "—"}
                        {c.end_date && (
                          <span className="block text-slate-600">
                            s.d. {formatDate(c.end_date)}
                          </span>
                        )}
                      </TableCell>
                      {!isDistributor && (
                        <TableCell className="text-center text-slate-400">
                          {c.realizations?.length ?? 0}
                        </TableCell>
                      )}
                      {!isDistributor && (
                        <TableCell className="text-slate-400 text-xs">
                          {c.submitted_at ? formatDate(c.submitted_at) : "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        {isReceipted ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                            Sudah Diterima
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-slate-600 bg-slate-700/40 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                            Belum Diterima
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

    </div>
  );
}

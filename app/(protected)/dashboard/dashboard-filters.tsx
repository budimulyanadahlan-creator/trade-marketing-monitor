"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { X, FileDown } from "lucide-react";

interface Option {
  id: string;
  name: string;
}

interface DashboardFiltersProps {
  departments: Option[];
  brands: Option[];
  regions: Option[];
  categories: Option[];
  fiscalYear: number;
  canExportPdf?: boolean;
  /** When set, the region dropdown is locked to this region (Sales dept users). */
  lockedRegionId?: string | null;
}

const FILTER_KEYS = ["department", "brand", "region", "promo_category", "quarter"];

export function DashboardFilters({
  departments,
  brands,
  regions,
  categories,
  fiscalYear,
  canExportPdf = false,
  lockedRegionId,
}: DashboardFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const hasActiveFilters = FILTER_KEYS.some((k) => searchParams.get(k));

  // Build PDF export URL with current filter params
  const pdfParams = new URLSearchParams(searchParams.toString());
  const pdfHref = `/api/export/pdf?${pdfParams.toString()}`;

  function clearFilters() {
    const next = new URLSearchParams();
    next.set("fiscal_year", String(fiscalYear));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Select
        value={searchParams.get("fiscal_year") ?? String(fiscalYear)}
        onChange={(e) => update("fiscal_year", e.target.value)}
        className="w-28"
      >
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </Select>

      <Select
        value={searchParams.get("quarter") ?? ""}
        onChange={(e) => update("quarter", e.target.value)}
        className="w-32"
      >
        <option value="">Semua Kuartal</option>
        <option value="1">Q1 (Apr–Jun)</option>
        <option value="2">Q2 (Jul–Sep)</option>
        <option value="3">Q3 (Okt–Des)</option>
        <option value="4">Q4 (Jan–Mar)</option>
      </Select>

      <Select
        value={searchParams.get("department") ?? ""}
        onChange={(e) => update("department", e.target.value)}
        className="w-44"
      >
        <option value="">Semua Dept.</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>

      <Select
        value={searchParams.get("brand") ?? ""}
        onChange={(e) => update("brand", e.target.value)}
        className="w-44"
      >
        <option value="">Semua Brand</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <Select
        value={lockedRegionId ?? (searchParams.get("region") ?? "")}
        onChange={(e) => { if (!lockedRegionId) update("region", e.target.value); }}
        disabled={!!lockedRegionId}
        className="w-40"
      >
        <option value="">Semua Region</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>

      <Select
        value={searchParams.get("promo_category") ?? ""}
        onChange={(e) => update("promo_category", e.target.value)}
        className="w-48"
      >
        <option value="">Semua Kategori</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 px-3 h-10 text-xs text-slate-400 hover:text-slate-200 border border-white/10 rounded-md hover:border-white/20 transition-colors"
        >
          <X className="h-3 w-3" />
          Reset
        </button>
      )}

      {canExportPdf && (
        <Link
          href={pdfHref}
          className="flex items-center gap-1.5 px-3 h-10 text-xs font-medium text-rose-400 border border-rose-500/20 bg-rose-500/8 rounded-md hover:bg-rose-500/15 transition-colors ml-auto"
        >
          <FileDown className="h-3.5 w-3.5" />
          Export PDF
        </Link>
      )}
    </div>
  );
}

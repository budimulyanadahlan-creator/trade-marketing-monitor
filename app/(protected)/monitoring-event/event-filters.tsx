"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EVENT_STATUS_LABELS, EVENT_TYPES, type EventListFilters } from "@/lib/event";
import type { EventStatus } from "@/types/database";
import type { Option } from "./event-form-dialog";

const FILTER_KEYS = ["type", "region", "brand", "status"] as const;

/** Filter tabel event; disimpan di query string bersama FY/kuartal. */
export function EventFilters({
  filters,
  regions,
  brands,
}: {
  filters: EventListFilters;
  regions: Option[];
  brands: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(next: URLSearchParams) {
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function update(key: (typeof FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    navigate(next);
  }

  function reset() {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    navigate(next);
  }

  const hasFilter = FILTER_KEYS.some((key) => filters[key]);

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-[repeat(4,minmax(0,12rem))_auto]">
      <Select aria-label="Filter jenis" value={filters.type ?? ""} onChange={(e) => update("type", e.target.value)}>
        <option value="">Semua jenis</option>
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
      <Select aria-label="Filter region" value={filters.region ?? ""} onChange={(e) => update("region", e.target.value)}>
        <option value="">Semua region</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Filter brand" value={filters.brand ?? ""} onChange={(e) => update("brand", e.target.value)}>
        <option value="">Semua brand</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Filter status" value={filters.status ?? ""} onChange={(e) => update("status", e.target.value)}>
        <option value="">Semua status</option>
        {(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((s) => (
          <option key={s} value={s}>
            {EVENT_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      {hasFilter && (
        <Button variant="ghost" size="sm" onClick={reset} className="h-10 text-slate-400">
          <X className="h-4 w-4" />
          Reset filter
        </Button>
      )}
    </div>
  );
}

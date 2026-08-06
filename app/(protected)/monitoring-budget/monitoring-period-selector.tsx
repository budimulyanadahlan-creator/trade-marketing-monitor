"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select } from "@/components/ui/select";

export function MonitoringPeriodSelector({
  fiscalYear,
  quarter,
  currentFiscalYear,
}: {
  fiscalYear: number;
  quarter: number;
  currentFiscalYear: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const years = Array.from({ length: 5 }, (_, i) => currentFiscalYear - 2 + i);

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex gap-2">
      <Select
        value={String(fiscalYear)}
        onChange={(e) => update("fy", e.target.value)}
        className="w-28"
      >
        {years.map((y) => (
          <option key={y} value={String(y)}>
            FY {y}
          </option>
        ))}
      </Select>
      <Select
        value={String(quarter)}
        onChange={(e) => update("q", e.target.value)}
        className="w-40"
      >
        <option value="1">Q1 (Apr–Jun)</option>
        <option value="2">Q2 (Jul–Sep)</option>
        <option value="3">Q3 (Okt–Des)</option>
        <option value="4">Q4 (Jan–Mar)</option>
      </Select>
    </div>
  );
}

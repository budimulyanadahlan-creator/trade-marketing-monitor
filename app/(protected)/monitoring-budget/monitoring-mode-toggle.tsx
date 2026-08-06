"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MonitoringMode } from "@/lib/monitoring-budget";

const OPTIONS: { value: MonitoringMode; label: string }[] = [
  { value: "komitmen", label: "Komitmen" },
  { value: "realisasi", label: "Realisasi" },
];

export function MonitoringModeToggle({ mode }: { mode: MonitoringMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function update(value: MonitoringMode) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("mode", value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/5 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => update(opt.value)}
          className={cn(
            "rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
            mode === opt.value
              ? "bg-emerald-500/20 text-emerald-300"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

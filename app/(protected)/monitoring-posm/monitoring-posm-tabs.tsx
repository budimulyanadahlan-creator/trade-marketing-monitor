import Link from "next/link";
import { cn } from "@/lib/utils";

export type MonitoringPosmTab = "posm" | "asset";

const TABS: { value: MonitoringPosmTab; label: string }[] = [
  { value: "posm", label: "POSM" },
  { value: "asset", label: "Asset" },
];

export function MonitoringPosmTabs({ active }: { active: MonitoringPosmTab }) {
  return (
    <div className="inline-flex rounded-md border border-white/10 bg-white/5 p-0.5">
      {TABS.map((tab) => (
        <Link
          key={tab.value}
          href={`/monitoring-posm?tab=${tab.value}`}
          scroll={false}
          className={cn(
            "rounded-[5px] px-4 py-1.5 text-sm font-medium transition-colors",
            active === tab.value
              ? "bg-emerald-500/20 text-emerald-300"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

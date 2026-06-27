import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn, formatIDR } from "@/lib/utils";

interface AlertCampaign {
  id: string;
  name: string;
  brand: string;
  department: string;
  requested_budget: number;
  actual_spent: number;
  percentage: number;
}

export function AlertSummary({ campaigns }: { campaigns: AlertCampaign[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
        <p className="text-sm font-medium text-slate-300">
          Alert Anggaran (≥ 80%)
        </p>
        {campaigns.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">
            {campaigns.length} campaign
          </span>
        )}
      </div>
      {campaigns.length === 0 ? (
        <p className="text-slate-500 text-sm">
          Tidak ada campaign yang mendekati batas anggaran.
        </p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {campaigns.map((c) => {
            const isOver = c.percentage >= 1;
            return (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="block rounded-lg border border-white/5 bg-white/3 p-3 hover:bg-white/8 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {c.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {c.brand}
                      {c.department ? ` · ${c.department}` : ""}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {formatIDR(c.actual_spent)} /{" "}
                      {formatIDR(c.requested_budget)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-bold px-2 py-0.5 rounded-full",
                      isOver
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-amber-500/20 text-amber-400"
                    )}
                  >
                    {(c.percentage * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-2 h-1 w-full rounded-full bg-slate-800">
                  <div
                    className={cn(
                      "h-1 rounded-full",
                      isOver ? "bg-rose-500" : "bg-amber-500"
                    )}
                    style={{ width: `${Math.min(c.percentage * 100, 100)}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

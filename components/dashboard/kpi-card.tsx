import { cn, formatIDR } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number;
  type: "currency" | "count";
  trend?: number;
}

export function KpiCard({ label, value, type, trend }: KpiCardProps) {
  const display =
    type === "currency" ? formatIDR(value) : value.toLocaleString("id-ID");
  const negative = value < 0;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-bold tracking-tight",
          negative ? "text-rose-400" : "text-slate-100"
        )}
      >
        {display}
      </p>
      {trend !== undefined && (
        <p
          className={cn(
            "text-xs",
            trend >= 20
              ? "text-emerald-400"
              : trend >= 5
              ? "text-amber-400"
              : "text-rose-400"
          )}
        >
          {trend.toFixed(1)}% tersisa
        </p>
      )}
    </div>
  );
}

"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatIDR } from "@/lib/utils";

interface QuarterData {
  quarter: string;
  budget: number;
  spent: number;
}

function fmtY(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}rb`;
  return String(v);
}

const TOOLTIP_STYLE = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#f1f5f9",
  fontSize: "12px",
};

export function BudgetChart({ data }: { data: QuarterData[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 h-full">
      <p className="text-sm font-medium text-slate-300 mb-4">
        Budget vs. Realisasi per Kuartal
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="quarter"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "#334155" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtY}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [
              typeof v === "number" ? formatIDR(v) : String(v),
              name === "budget" ? "Budget" : "Realisasi",
            ]}
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
          />
          <Legend
            formatter={(v) => (
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                {v === "budget" ? "Budget" : "Realisasi"}
              </span>
            )}
          />
          <Bar dataKey="budget" name="budget" fill="#475569" radius={[4, 4, 0, 0]} />
          <Bar dataKey="spent" name="spent" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

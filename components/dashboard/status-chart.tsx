"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { CampaignStatus } from "@/types/database";

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "#64748b",
  submitted: "#3b82f6",
  approved_l1: "#06b6d4",
  approved_l2: "#0ea5e9",
  approved_l3: "#8b5cf6",
  approved_l4: "#6366f1",
  approved: "#10b981",
  rejected: "#f43f5e",
  ongoing: "#f59e0b",
  claim_submitted: "#f97316",
  paid: "#14b8a6",
  completed: "#059669",
  cancelled: "#334155",
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  approved_l1: "Disetujui L1",
  approved_l2: "Disetujui L2",
  approved_l3: "Disetujui L3",
  approved_l4: "Disetujui L4",
  approved: "Disetujui",
  rejected: "Ditolak",
  ongoing: "Berjalan",
  claim_submitted: "Klaim Diajukan",
  paid: "Paid",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#f1f5f9",
  fontSize: "12px",
};

export function StatusChart({ data }: { data: Record<string, number> }) {
  const chartData = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      name: STATUS_LABELS[status as CampaignStatus] ?? status,
      value: count,
      color: STATUS_COLORS[status as CampaignStatus] ?? "#64748b",
    }));

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5 h-full">
      <p className="text-sm font-medium text-slate-300 mb-4">
        Distribusi Status Campaign
      </p>
      {chartData.length === 0 ? (
        <div className="flex h-[240px] items-center justify-center text-slate-500 text-sm">
          Belum ada data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend
              formatter={(v) => (
                <span style={{ color: "#94a3b8", fontSize: "11px" }}>{v}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

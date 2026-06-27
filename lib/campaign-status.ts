import type { CampaignStatus } from "@/types/database";

export const statusConfig: Record<
  CampaignStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-slate-500/15 text-slate-400 border-slate-500/25",
  },
  submitted: {
    label: "Diajukan",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
  approved_l1: {
    label: "Disetujui L1",
    className: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  },
  approved_l2: {
    label: "Disetujui L2",
    className: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  },
  approved_l3: {
    label: "Disetujui L3",
    className: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  },
  approved_l4: {
    label: "Disetujui L4",
    className: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25",
  },
  approved: {
    label: "Disetujui",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  },
  rejected: {
    label: "Ditolak",
    className: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  },
  ongoing: {
    label: "Berjalan",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  },
  claim_submitted: {
    label: "Klaim Diajukan",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  },
  paid: {
    label: "Paid",
    className: "bg-teal-500/15 text-teal-400 border-teal-500/25",
  },
  completed: {
    label: "Selesai",
    className: "bg-emerald-700/15 text-emerald-300 border-emerald-700/25",
  },
  cancelled: {
    label: "Dibatalkan",
    className: "bg-slate-700/15 text-slate-500 border-slate-700/25",
  },
};

export function getStatusConfig(status: CampaignStatus) {
  return statusConfig[status] ?? statusConfig.draft;
}

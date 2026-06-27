"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";

// Statuses that represent intermediate approval levels (awaiting next approver)
const PENDING_APPROVAL_STATUSES = new Set([
  "submitted",
  "approved_l1",
  "approved_l2",
  "approved_l3",
  "approved_l4",
]);

const PENDING_STATUS_LABEL: Record<string, string> = {
  submitted: "Menunggu persetujuan L1",
  approved_l1: "Menunggu persetujuan L2",
  approved_l2: "Menunggu persetujuan L3",
  approved_l3: "Menunggu persetujuan L4",
  approved_l4: "Menunggu persetujuan akhir",
};

interface RealtimeNotificationsProps {
  userId: string;
  role: UserRole;
  departmentId: string | null;
  /** Statuses this user is responsible for approving (computed server-side) */
  pendingStatuses: string[];
}

type CampaignPayload = {
  id: string;
  name: string;
  status: string;
  department_id: string;
  created_by: string;
  actual_spent: number;
  requested_budget: number;
};

export function RealtimeNotifications({
  userId,
  role,
  departmentId,
  pendingStatuses,
}: RealtimeNotificationsProps) {
  // Track which campaign IDs we've already toasted to avoid duplicates on reconnect
  const notifiedRef = useRef<Set<string>>(new Set());
  const pendingSet = useRef(new Set(pendingStatuses));

  // Keep pendingSet in sync if prop changes
  useEffect(() => {
    pendingSet.current = new Set(pendingStatuses);
  }, [pendingStatuses]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaigns",
        },
        (payload) => {
          const campaign = payload.new as CampaignPayload;
          const prev = payload.old as Partial<CampaignPayload>;

          if (process.env.NODE_ENV === "development") {
            console.log("[Realtime] campaigns UPDATE", { campaign, role, departmentId });
          }

          // ── Status-change notifications ──────────────────────────────

          if (prev.status !== campaign.status) {
            const key = `${campaign.id}-${campaign.status}`;
            if (!notifiedRef.current.has(key)) {
              notifiedRef.current.add(key);

              // Admin/superadmin: specific popup for brand-new SKP submission
              if (
                (role === "admin" || role === "superadmin") &&
                campaign.status === "submitted" &&
                campaign.created_by !== userId
              ) {
                toast.warning("Pengajuan SKP Baru", {
                  description: `${campaign.name} — menunggu persetujuan Anda`,
                  action: {
                    label: "Lihat",
                    onClick: () => {
                      window.location.href = `/campaigns/${campaign.id}`;
                    },
                  },
                  duration: 8000,
                });
              } else if (
                // Notify this user when a campaign moves into one of their pending statuses
                pendingSet.current.has(campaign.status) &&
                campaign.created_by !== userId
              ) {
                const label =
                  PENDING_STATUS_LABEL[campaign.status] ?? "Menunggu persetujuan";
                toast.info(`Campaign menunggu tindakan Anda`, {
                  description: `${campaign.name} — ${label}`,
                });
              }

              // Notify campaign owner on approval or rejection
              if (campaign.created_by === userId) {
                if (campaign.status === "approved") {
                  toast.success("Campaign Anda disetujui!", {
                    description: campaign.name,
                  });
                } else if (PENDING_APPROVAL_STATUSES.has(campaign.status)) {
                  const levelLabel =
                    PENDING_STATUS_LABEL[campaign.status] ?? "Menunggu persetujuan berikutnya";
                  toast.success("Campaign Anda lolos satu level persetujuan", {
                    description: `${campaign.name} — ${levelLabel}`,
                  });
                } else if (campaign.status === "rejected") {
                  toast.error("Campaign Anda ditolak", {
                    description: campaign.name,
                  });
                }
              }
            }
          }

          // ── Spend threshold notifications (for campaign owner only) ──

          if (campaign.created_by === userId && campaign.requested_budget > 0) {
            const prevSpent = prev.actual_spent ?? 0;
            const newSpent = campaign.actual_spent ?? 0;
            const budget = campaign.requested_budget;

            const prevPct = (prevSpent / budget) * 100;
            const newPct = (newSpent / budget) * 100;

            // Fire 100% toast exactly once when threshold is crossed upward
            if (prevPct < 100 && newPct >= 100) {
              const key100 = `${campaign.id}-spend-100`;
              if (!notifiedRef.current.has(key100)) {
                notifiedRef.current.add(key100);
                toast.error("Anggaran campaign telah habis (≥100%)", {
                  description: campaign.name,
                });
              }
            } else if (prevPct < 80 && newPct >= 80) {
              // Fire 80% toast exactly once when threshold is crossed upward
              const key80 = `${campaign.id}-spend-80`;
              if (!notifiedRef.current.has(key80)) {
                notifiedRef.current.add(key80);
                toast.warning("Anggaran campaign mendekati batas (≥80%)", {
                  description: campaign.name,
                });
              }
            }
          }
        }
      )
      .subscribe((status, err) => {
        if (process.env.NODE_ENV === "development") {
          if (status !== "SUBSCRIBED") {
            console.warn("[Realtime] subscription status:", status, err);
          } else {
            console.log("[Realtime] subscribed ok — userId:", userId, "role:", role);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, role, departmentId]);

  return null;
}

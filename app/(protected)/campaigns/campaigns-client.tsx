"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, ExternalLink, Pencil, CheckSquare, Download } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatIDR } from "@/lib/utils";
import { getStatusConfig } from "@/lib/campaign-status";
import { BudgetProgress } from "@/components/budget-progress";
import { CampaignFormModal } from "./campaign-form-modal";
import { createDistributorReceiptAction } from "@/app/actions/campaigns";
import type { UserRole, CampaignRow } from "@/types/database";

type CampaignWithJoins = CampaignRow & {
  department: { name: string } | null;
  brand: { name: string } | null;
  region: { name: string } | null;
  channel: { name: string } | null;
  promotion_category: { name: string; account_code: string } | null;
  action_approval: { name: string } | null;
  vendor: { name: string } | null;
  realizations: { id: string }[] | null;
};

interface Props {
  campaigns: CampaignWithJoins[];
  userRole: UserRole;
  departments: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  categories: { id: string; name: string; type: string; account_code: string }[];
  actionApprovals: { id: string; name: string; brand_id: string | null; start_date: string; end_date: string; target_budget: number }[];
  vendors: { id: string; name: string }[];
  masterBudgets: { id: string; promotion_category_id: string; fiscal_year: number; quarter: number; total_amount: number }[];
  lockedRegionId?: string | null;
  receiptedCampaignIds?: string[];
}

export function CampaignsClient({
  campaigns,
  userRole,
  departments,
  brands,
  regions,
  channels,
  categories,
  actionApprovals,
  vendors,
  masterBudgets,
  lockedRegionId,
  receiptedCampaignIds = [],
}: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignWithJoins | null>(null);

  const [checklistCampaign, setChecklistCampaign] = useState<CampaignWithJoins | null>(null);
  const [checklistNotes, setChecklistNotes] = useState("");
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [localReceiptedIds, setLocalReceiptedIds] = useState<Set<string>>(
    new Set(receiptedCampaignIds)
  );

  const isDistributor = userRole === "distributor";
  const masterData = { departments, brands, regions, channels, categories, actionApprovals, vendors, masterBudgets, lockedRegionId };

  function openEdit(campaign: CampaignWithJoins) {
    setEditingCampaign(campaign);
    setModalOpen(true);
  }

  function handleModalClose(open: boolean) {
    setModalOpen(open);
    if (!open) setEditingCampaign(null);
  }

  async function handleChecklist() {
    if (!checklistCampaign) return;
    setChecklistLoading(true);
    const result = await createDistributorReceiptAction(
      checklistCampaign.id,
      checklistNotes || null
    );
    setChecklistLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("SKP berhasil di-checklist sebagai diterima");
      setLocalReceiptedIds((prev) => new Set([...prev, checklistCampaign.id]));
      setChecklistCampaign(null);
      setChecklistNotes("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">SKP</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {campaigns.length} SKP ditemukan
          </p>
        </div>
        {["user", "manager", "finance", "admin", "superadmin"].includes(userRole) && (
          <Button size="sm" onClick={() => { setEditingCampaign(null); setModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            SKP Baru
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>No. SKP</TableHead>
              <TableHead>Nama SKP</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Departemen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead className="min-w-[120px]">Serapan</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Diajukan</TableHead>
              {isDistributor && <TableHead>Status Penerimaan</TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.length > 0 ? (
              campaigns.map((campaign) => {
                const statusCfg = getStatusConfig(campaign.status);
                return (
                  <TableRow key={campaign.id} className="border-white/8">
                    <TableCell className="text-slate-400 text-xs font-mono">
                      {campaign.skp_number ?? "—"}
                    </TableCell>
                    <TableCell className="font-medium text-slate-100">
                      {isDistributor && !localReceiptedIds.has(campaign.id) ? (
                        campaign.name
                      ) : (
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="hover:text-emerald-400 transition-colors"
                        >
                          {campaign.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {campaign.brand?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {campaign.department?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}
                      >
                        {statusCfg.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      {formatIDR(campaign.requested_budget)}
                    </TableCell>
                    <TableCell>
                      {campaign.requested_budget > 0 && campaign.actual_spent > 0 ? (
                        <BudgetProgress
                          actualSpent={campaign.actual_spent}
                          requestedBudget={campaign.requested_budget}
                          showLabel
                          className="w-28"
                        />
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {(campaign.realizations?.length ?? 0) > 0
                        ? `${campaign.realizations!.length} invoice`
                        : <span className="text-slate-600">—</span>}
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs">
                      {campaign.submitted_at
                        ? formatDate(campaign.submitted_at)
                        : "—"}
                    </TableCell>
                    {isDistributor && (
                      <TableCell>
                        {localReceiptedIds.has(campaign.id) ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                            Sudah Diterima
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-slate-600 bg-slate-700/40 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                            Belum Diterima
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {isDistributor && !localReceiptedIds.has(campaign.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => {
                              setChecklistCampaign(campaign);
                              setChecklistNotes("");
                            }}
                          >
                            <CheckSquare className="h-3 w-3" />
                            Diterima
                          </Button>
                        )}
                        {(campaign.status === "draft" || campaign.status === "rejected") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(campaign)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                        {["approved", "ongoing", "claim_submitted", "paid", "completed"].includes(campaign.status) &&
                          (!isDistributor || localReceiptedIds.has(campaign.id)) && (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Download PDF SKP"
                          >
                            <a href={`/api/skp-pdf/${campaign.id}`} download>
                              <Download className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                        {(!isDistributor || localReceiptedIds.has(campaign.id)) && (
                          <Button asChild variant="outline" size="sm" className="h-7 w-7 p-0">
                            <Link href={`/campaigns/${campaign.id}`}>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={isDistributor ? 11 : 10}
                  className="text-center py-16 text-slate-500"
                >
                  Belum ada SKP. Klik "SKP Baru" untuk memulai.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Checklist Diterima Modal */}
      <Dialog
        open={!!checklistCampaign}
        onOpenChange={(open) => {
          if (!open) { setChecklistCampaign(null); setChecklistNotes(""); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Konfirmasi Penerimaan SKP</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-400">
              SKP: <span className="font-medium text-slate-200">{checklistCampaign?.name}</span>
            </p>
            <Textarea
              placeholder="SKP sudah diterima dengan baik"
              value={checklistNotes}
              onChange={(e) => setChecklistNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setChecklistCampaign(null); setChecklistNotes(""); }}
              disabled={checklistLoading}
            >
              Batal
            </Button>
            <Button onClick={handleChecklist} disabled={checklistLoading}>
              {checklistLoading ? "Menyimpan..." : "Konfirmasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CampaignFormModal
        open={modalOpen}
        onOpenChange={handleModalClose}
        initialData={editingCampaign ? {
          id: editingCampaign.id,
          name: editingCampaign.name,
          department_id: editingCampaign.department_id,
          brand_id: editingCampaign.brand_id,
          region_id: editingCampaign.region_id,
          channel_id: editingCampaign.channel_id ?? "",
          promotion_category_id: editingCampaign.promotion_category_id ?? "",
          action_approval_id: editingCampaign.action_approval_id ?? "",
          vendor_id: editingCampaign.vendor_id ?? "",
          store_id: editingCampaign.store_id ?? "",
          objective: editingCampaign.objective ?? "",
          mechanism: editingCampaign.mechanism ?? "",
          avg_sales_3months: editingCampaign.avg_sales_3months
            ? String(editingCampaign.avg_sales_3months)
            : "",
          requested_budget: editingCampaign.requested_budget?.toString() ?? "0",
          sales_projection: editingCampaign.sales_projection?.toString() ?? "0",
          start_date: editingCampaign.start_date ?? "",
          end_date: editingCampaign.end_date ?? "",
        } : undefined}
        existingFiles={[]}
        {...masterData}
      />
    </div>
  );
}

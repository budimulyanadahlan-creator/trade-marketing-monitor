"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  Pencil,
  FileText,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Check,
  XCircle,
  Clock,
  Send,
  Plus,
  Trash2,
  Receipt,
  BadgeCheck,
  CircleCheckBig,
  PackageCheck,
  Download,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatIDR } from "@/lib/utils";
import { getStatusConfig } from "@/lib/campaign-status";
import { BudgetProgress } from "@/components/budget-progress";
import {
  addRealizationAction,
  deleteRealizationAction,
  submitKlaimAction,
  markAsPaidAction,
  markAsCompletedAction,
} from "@/app/actions/realizations";
import { upsertClaimChecklistAction } from "@/app/actions/claim-checklist";
import { CampaignFormModal } from "../campaign-form-modal";
import type {
  CampaignRow,
  CampaignFileRow,
  ApprovalHistoryRow,
  RealizationRow,
  DistributorReceiptRow,
  UserRole,
  CampaignStatus,
} from "@/types/database";
import type { ClaimDocument } from "./page";

type RealizationWithCreator = RealizationRow & {
  creator: { full_name: string } | null;
};

type DistributorReceiptWithReceiver = DistributorReceiptRow & {
  receiver: { full_name: string } | null;
};

type CampaignWithJoins = CampaignRow & {
  department: { name: string } | null;
  brand: { name: string } | null;
  region: { name: string } | null;
  channel: { name: string } | null;
  promotion_category: { name: string; account_code: string } | null;
  action_approval: { name: string } | null;
  vendor: { name: string } | null;
};

type ApprovalHistoryWithActor = ApprovalHistoryRow & {
  actor: { full_name: string } | null;
};

interface Props {
  campaign: CampaignWithJoins;
  files: CampaignFileRow[];
  approvalHistory: ApprovalHistoryWithActor[];
  realizations: RealizationWithCreator[];
  distributorReceipts: DistributorReceiptWithReceiver[];
  claimDocuments: ClaimDocument[];
  isEditable: boolean;
  userRole: UserRole;
  departments: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  categories: { id: string; name: string; type: string; account_code: string }[];
  actionApprovals: {
    id: string;
    name: string;
    brand_id: string | null;
    start_date: string;
    end_date: string;
    target_budget: number;
  }[];
  vendors: { id: string; name: string }[];
  masterBudgets: { id: string; promotion_category_id: string; fiscal_year: number; quarter: number; total_amount: number }[];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-3 border-b border-white/6 last:border-0">
      <dt className="w-44 flex-shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 flex-1">{value ?? "—"}</dd>
    </div>
  );
}

function SignedFileLink({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    try {
      const res = await fetch(`/api/upload?file_id=${fileId}`);
      if (!res.ok) {
        toast.error("Gagal mendapatkan link file");
        return;
      }
      const { url } = await res.json();
      window.open(url, "_blank");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={open}
      disabled={loading}
      className="flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileText className="h-3.5 w-3.5" />
      )}
      {fileName}
      <ExternalLink className="h-3 w-3 opacity-60" />
    </button>
  );
}

const actionIconMap: Record<string, React.ReactNode> = {
  submitted: <Send className="h-3.5 w-3.5 text-blue-400" />,
  approved_l1: <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />,
  approved_l2: <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />,
  approved_l3: <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />,
  approved_l4: <CheckCircle2 className="h-3.5 w-3.5 text-cyan-400" />,
  approved: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-rose-400" />,
};

const actionLabelMap: Record<string, string> = {
  submitted: "Diajukan",
  approved_l1: "Disetujui (L1)",
  approved_l2: "Disetujui (L2)",
  approved_l3: "Disetujui (L3)",
  approved_l4: "Disetujui (L4)",
  approved: "Disetujui (Final)",
  rejected: "Ditolak",
};

// ============================================================
// Add Realization Dialog
// ============================================================

function AddRealizationDialog({
  campaignId,
  requestedBudget,
  currentActualSpent,
  unfulfilledClaimDocs,
  open,
  onOpenChange,
}: {
  campaignId: string;
  requestedBudget: number;
  currentActualSpent: number;
  unfulfilledClaimDocs: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [realizationDate, setRealizationDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = Number(amount.replace(/\D/g, ""));
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error("Masukkan nominal realisasi yang valid");
      return;
    }

    startTransition(async () => {
      const result = await addRealizationAction({
        campaignId,
        invoiceNumber,
        amount: parsedAmount,
        realizationDate,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      const percent = result.percentSpent ?? 0;
      if (percent >= 100) {
        toast.error("Anggaran SKP telah habis (≥100%)", {
          description: `Total realisasi: ${formatIDR(result.newActualSpent ?? 0)}`,
        });
      } else if (percent >= 80) {
        toast.warning("Anggaran SKP mendekati batas (≥80%)", {
          description: `Total realisasi: ${formatIDR(result.newActualSpent ?? 0)}`,
        });
      } else {
        toast.success("Realisasi berhasil dicatat");
      }

      setInvoiceNumber("");
      setAmount("");
      setRealizationDate(new Date().toISOString().slice(0, 10));
      onOpenChange(false);
    });
  }

  const parsedAmount = Number(amount.replace(/\D/g, "") || "0");
  const projectedSpent = currentActualSpent + parsedAmount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Realisasi</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {unfulfilledClaimDocs.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2">
                <TriangleAlert className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-400">
                    Dokumen klaim belum lengkap
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {unfulfilledClaimDocs.map((name) => (
                      <li key={name} className="text-xs text-amber-300/80">
                        • {name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="invoice">No. Invoice</Label>
            <Input
              id="invoice"
              placeholder="INV-2024-001"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Nominal (IDR)</Label>
            <Input
              id="amount"
              placeholder="contoh: 5000000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              required
            />
            {amount && (
              <p className="text-xs text-slate-400">{formatIDR(parsedAmount)}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date">Tanggal Realisasi</Label>
            <Input
              id="date"
              type="date"
              value={realizationDate}
              onChange={(e) => setRealizationDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
              required
            />
          </div>

          {requestedBudget > 0 && parsedAmount > 0 && (
            <div className="space-y-1.5 p-3 rounded-lg border border-white/8 bg-white/2">
              <p className="text-xs text-slate-500">Proyeksi setelah pencatatan</p>
              <BudgetProgress
                actualSpent={projectedSpent}
                requestedBudget={requestedBudget}
                showLabel
              />
              <p className="text-xs text-slate-500">
                Budget: {formatIDR(requestedBudget)} · Realisasi saat ini:{" "}
                {formatIDR(currentActualSpent)}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isPending || !invoiceNumber || !amount}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Claim Checklist Section
// ============================================================

const CHECKLIST_EDITABLE_STATUSES: CampaignStatus[] = [
  "approved",
  "ongoing",
  "claim_submitted",
];

function ClaimChecklistSection({
  campaignId,
  campaignStatus,
  userRole,
  documents,
}: {
  campaignId: string;
  campaignStatus: CampaignStatus;
  userRole: UserRole;
  documents: ClaimDocument[];
}) {
  const isDistributor = userRole === "distributor";
  const isEditable =
    isDistributor && CHECKLIST_EDITABLE_STATUSES.includes(campaignStatus);

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [localState, setLocalState] = useState<Record<string, boolean>>(
    Object.fromEntries(documents.map((d) => [d.documentTypeId, d.isFulfilled]))
  );

  async function handleToggle(documentTypeId: string) {
    if (!isEditable || pendingIds.has(documentTypeId)) return;

    const current = localState[documentTypeId] ?? false;
    const next = !current;

    setPendingIds((prev) => new Set(prev).add(documentTypeId));
    setLocalState((prev) => ({ ...prev, [documentTypeId]: next }));

    const result = await upsertClaimChecklistAction(campaignId, documentTypeId, next);

    setPendingIds((prev) => {
      const s = new Set(prev);
      s.delete(documentTypeId);
      return s;
    });

    if (result.error) {
      setLocalState((prev) => ({ ...prev, [documentTypeId]: current }));
      toast.error(result.error);
    }
  }

  const fulfilledCount = Object.values(localState).filter(Boolean).length;
  const totalCount = documents.length;

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Dokumen Klaim
        </h2>
        <span className="text-xs text-slate-500">
          {fulfilledCount}/{totalCount} dokumen siap
        </span>
      </div>

      {!isDistributor && (
        <p className="text-xs text-slate-500 mb-3">
          Status checklist dokumen klaim yang diisi distributor (read-only).
        </p>
      )}
      {isDistributor && !isEditable && (
        <p className="text-xs text-slate-500 mb-3">
          Checklist tidak dapat diubah saat SKP berstatus ini.
        </p>
      )}

      <div className="space-y-2">
        {documents.map((doc) => {
          const fulfilled = localState[doc.documentTypeId] ?? doc.isFulfilled;
          const pending = pendingIds.has(doc.documentTypeId);

          return (
            <label
              key={doc.documentTypeId}
              className={`flex items-center gap-3 rounded-lg border border-white/8 px-4 py-3 transition-colors ${
                isEditable && !pending
                  ? "cursor-pointer hover:bg-white/4"
                  : "cursor-default"
              }`}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />
              ) : !isEditable ? (
                <div
                  className={`h-4 w-4 rounded flex-shrink-0 border flex items-center justify-center ${
                    fulfilled
                      ? "bg-rose-500 border-rose-500"
                      : "border-slate-600 bg-slate-800"
                  }`}
                >
                  {fulfilled && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
              ) : (
                <input
                  type="checkbox"
                  checked={fulfilled}
                  onChange={() => handleToggle(doc.documentTypeId)}
                  disabled={pending}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-emerald-500 flex-shrink-0"
                />
              )}
              <span
                className={`text-sm flex-1 ${
                  fulfilled ? "text-slate-200" : "text-slate-400"
                }`}
              >
                {doc.name}
              </span>
              {isEditable && fulfilled && !pending && (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Realizations Section
// ============================================================

function RealizationsSection({
  campaign,
  realizations,
  canAddRealization,
  canSubmitKlaim,
  canMarkPaid,
  canMarkCompleted,
  unfulfilledClaimDocs,
}: {
  campaign: CampaignWithJoins;
  realizations: RealizationWithCreator[];
  canAddRealization: boolean;
  canSubmitKlaim: boolean;
  canMarkPaid: boolean;
  canMarkCompleted: boolean;
  unfulfilledClaimDocs: string[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPendingKlaim, startKlaim] = useTransition();
  const [isPendingPaid, startPaid] = useTransition();
  const [isPendingCompleted, startCompleted] = useTransition();

  function handleDelete(id: string) {
    setDeletingId(id);
    startKlaim(async () => {
      const result = await deleteRealizationAction(id, campaign.id);
      setDeletingId(null);
      if (result.error) toast.error(result.error);
      else toast.success("Realisasi dihapus");
    });
  }

  function handleSubmitKlaim() {
    startKlaim(async () => {
      const result = await submitKlaimAction(campaign.id);
      if (result.error) toast.error(result.error);
      else toast.success("Klaim berhasil diajukan");
    });
  }

  function handleMarkPaid() {
    startPaid(async () => {
      const result = await markAsPaidAction(campaign.id);
      if (result.error) toast.error(result.error);
      else toast.success("SKP ditandai sebagai Paid");
    });
  }

  function handleMarkCompleted() {
    startCompleted(async () => {
      const result = await markAsCompletedAction(campaign.id);
      if (result.error) toast.error(result.error);
      else toast.success("SKP diselesaikan");
    });
  }

  const totalRealized = realizations.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Realisasi
        </h2>
        <div className="flex items-center gap-2">
          {canSubmitKlaim && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSubmitKlaim}
              disabled={isPendingKlaim || realizations.length === 0}
            >
              {isPendingKlaim ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Receipt className="h-4 w-4" />
              )}
              Submit Klaim
            </Button>
          )}
          {canMarkPaid && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkPaid}
              disabled={isPendingPaid}
              className="border-teal-500/40 text-teal-400 hover:bg-teal-500/10"
            >
              {isPendingPaid ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BadgeCheck className="h-4 w-4" />
              )}
              Tandai Paid
            </Button>
          )}
          {canMarkCompleted && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkCompleted}
              disabled={isPendingCompleted}
              className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            >
              {isPendingCompleted ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CircleCheckBig className="h-4 w-4" />
              )}
              Selesaikan
            </Button>
          )}
          {canAddRealization && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Tambah
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {campaign.requested_budget > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-white/6 bg-white/2">
          <div className="flex justify-between text-xs text-slate-500 mb-2">
            <span>Total Realisasi: {formatIDR(totalRealized)}</span>
            <span>Budget: {formatIDR(campaign.requested_budget)}</span>
          </div>
          <BudgetProgress
            actualSpent={totalRealized}
            requestedBudget={campaign.requested_budget}
            showLabel
          />
        </div>
      )}

      {/* Realizations table */}
      {realizations.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left">
                <th className="pb-2 text-xs text-slate-500 font-medium">
                  No. Invoice
                </th>
                <th className="pb-2 text-xs text-slate-500 font-medium">
                  Nominal
                </th>
                <th className="pb-2 text-xs text-slate-500 font-medium">
                  Tanggal
                </th>
                <th className="pb-2 text-xs text-slate-500 font-medium">
                  Dicatat Oleh
                </th>
                {canAddRealization && (
                  <th className="pb-2 w-8" />
                )}
              </tr>
            </thead>
            <tbody>
              {realizations.map((r) => (
                <tr key={r.id} className="border-b border-white/4 last:border-0">
                  <td className="py-2.5 text-slate-300 font-mono text-xs">
                    {r.invoice_number}
                  </td>
                  <td className="py-2.5 text-slate-200">
                    {formatIDR(r.amount)}
                  </td>
                  <td className="py-2.5 text-slate-400 text-xs">
                    {formatDate(r.realization_date)}
                  </td>
                  <td className="py-2.5 text-slate-400 text-xs">
                    {r.creator?.full_name ?? "-"}
                  </td>
                  {canAddRealization && (
                    <td className="py-2.5">
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deletingId === r.id}
                        className="text-slate-600 hover:text-rose-400 transition-colors disabled:opacity-40"
                      >
                        {deletingId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-600 text-center py-4">
          Belum ada realisasi dicatat.
        </p>
      )}

      <AddRealizationDialog
        campaignId={campaign.id}
        requestedBudget={campaign.requested_budget}
        currentActualSpent={campaign.actual_spent}
        unfulfilledClaimDocs={unfulfilledClaimDocs}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  );
}

// ============================================================
// Main Client Component
// ============================================================

export function CampaignDetailClient({
  campaign,
  files,
  approvalHistory,
  realizations,
  distributorReceipts,
  claimDocuments,
  isEditable,
  userRole,
  departments,
  brands,
  regions,
  channels,
  categories,
  actionApprovals,
  vendors,
  masterBudgets,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const statusCfg = getStatusConfig(campaign.status);

  const canAddRealization =
    ["admin", "superadmin"].includes(userRole) &&
    (campaign.status === "approved" || campaign.status === "ongoing" || campaign.status === "paid");

  const hasDistributor = distributorReceipts.length > 0;
  const unfulfilledClaimDocs =
    hasDistributor && claimDocuments.length > 0
      ? claimDocuments.filter((d) => !d.isFulfilled).map((d) => d.name)
      : [];

  const canSubmitKlaim =
    ["admin", "superadmin"].includes(userRole) &&
    campaign.status === "ongoing";

  const canMarkPaid =
    ["finance", "superadmin"].includes(userRole) &&
    campaign.status === "claim_submitted";

  const canMarkCompleted =
    ["finance", "admin", "superadmin"].includes(userRole) &&
    campaign.status === "paid";

  const PDF_ELIGIBLE_STATUSES = [
    "approved", "ongoing", "claim_submitted", "paid", "completed",
  ] as const;
  const canDownloadPdf = PDF_ELIGIBLE_STATUSES.includes(
    campaign.status as (typeof PDF_ELIGIBLE_STATUSES)[number]
  );

  const showRealizationsSection =
    canAddRealization ||
    canSubmitKlaim ||
    canMarkPaid ||
    canMarkCompleted ||
    realizations.length > 0;

  const initialFormData = {
    id: campaign.id,
    name: campaign.name,
    department_id: campaign.department_id,
    brand_id: campaign.brand_id,
    region_id: campaign.region_id,
    channel_id: campaign.channel_id ?? "",
    promotion_category_id: campaign.promotion_category_id ?? "",
    action_approval_id: campaign.action_approval_id ?? "",
    vendor_id: campaign.vendor_id ?? "",
    objective: campaign.objective ?? "",
    mechanism: campaign.mechanism ?? "",
    avg_sales_3months: campaign.avg_sales_3months ? String(campaign.avg_sales_3months) : "",
    requested_budget: campaign.requested_budget ? String(campaign.requested_budget) : "",
    sales_projection: campaign.sales_projection ? String(campaign.sales_projection) : "",
    start_date: campaign.start_date ?? "",
    end_date: campaign.end_date ?? "",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/campaigns">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-100">
                {campaign.name}
              </h1>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}
              >
                {statusCfg.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Dibuat {formatDate(campaign.created_at)}
              {campaign.submitted_at
                ? ` · Diajukan ${formatDate(campaign.submitted_at)}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canDownloadPdf && (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/skp-pdf/${campaign.id}`} download>
                <Download className="h-4 w-4" />
                Download PDF
              </a>
            </Button>
          )}
          {isEditable && (
            <Button size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Edit SKP
            </Button>
          )}
        </div>
      </div>

      {/* SKP Number & AA Reference */}
      <div className="rounded-xl border border-white/8 bg-white/2 px-6 py-4 flex flex-wrap gap-8">
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Nomor SKP</p>
          <p className={`text-xl font-bold font-mono tracking-wide ${campaign.skp_number ? "text-emerald-300" : "text-slate-600"}`}>
            {campaign.skp_number ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Nomor AA Reference</p>
          <p className={`text-sm font-semibold ${campaign.aa_reference_number ? "text-slate-200" : "text-slate-600"}`}>
            {campaign.aa_reference_number ?? "—"}
          </p>
        </div>
      </div>

      {/* Rejection notice */}
      {campaign.status === "rejected" &&
        (() => {
          const latestRejection = [...approvalHistory]
            .reverse()
            .find((h) => h.action === "rejected");
          return (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
              <p className="text-sm font-semibold text-rose-400 mb-1">
                SKP Ditolak
              </p>
              {latestRejection?.comment ? (
                <p className="text-sm text-slate-300 mb-2">
                  &ldquo;{latestRejection.comment}&rdquo;
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                {latestRejection
                  ? `Ditolak oleh ${latestRejection.actor?.full_name ?? "—"} · ${formatDate(latestRejection.created_at)}`
                  : "Edit dan ajukan kembali untuk diproses ulang."}
              </p>
            </div>
          );
        })()}

      {/* Basic info */}
      <div className="rounded-xl border border-white/8 bg-white/2 p-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
          Info Dasar
        </h2>
        <dl>
          <DetailRow label="Nama SKP" value={campaign.name} />
          <DetailRow label="Departemen" value={campaign.department?.name} />
          <DetailRow label="Brand" value={campaign.brand?.name} />
          <DetailRow label="Region" value={campaign.region?.name} />
        </dl>
      </div>

      {/* SKP details */}
      <div className="rounded-xl border border-white/8 bg-white/2 p-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
          Detail SKP
        </h2>
        <dl>
          <DetailRow label="Channel" value={campaign.channel?.name} />
          <DetailRow
            label="Kategori Promosi"
            value={
              campaign.promotion_category
                ? `[${campaign.promotion_category.account_code}] ${campaign.promotion_category.name}`
                : null
            }
          />
          <DetailRow label="AA" value={campaign.action_approval?.name} />
          <DetailRow label="Vendor" value={campaign.vendor?.name} />
          <DetailRow label="Objective" value={campaign.objective} />
          <DetailRow label="Mekanisme" value={campaign.mechanism || null} />
        </dl>
      </div>

      {/* Budget & period */}
      <div className="rounded-xl border border-white/8 bg-white/2 p-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
          Budget & Periode
        </h2>
        <dl>
          {campaign.avg_sales_3months > 0 && (
            <DetailRow
              label="Rata-Rata Penjualan 3 Bln"
              value={formatIDR(campaign.avg_sales_3months)}
            />
          )}
          <DetailRow
            label="Budget Diajukan"
            value={
              <span className="font-semibold text-emerald-400">
                {formatIDR(campaign.requested_budget)}
              </span>
            }
          />
          {campaign.sales_projection > 0 && (
            <DetailRow
              label="Sales Projection"
              value={formatIDR(campaign.sales_projection)}
            />
          )}
          {campaign.sales_projection > 0 && campaign.requested_budget > 0 && (
            <DetailRow
              label="Cost Ratio"
              value={
                <span className="font-semibold text-slate-200">
                  {(
                    (campaign.requested_budget / campaign.sales_projection) *
                    100
                  ).toFixed(1)}
                  %
                </span>
              }
            />
          )}
          <DetailRow
            label="Total Realisasi"
            value={formatIDR(campaign.actual_spent)}
          />
          {campaign.requested_budget > 0 && campaign.actual_spent > 0 && (
            <DetailRow
              label="Serapan Anggaran"
              value={
                <BudgetProgress
                  actualSpent={campaign.actual_spent}
                  requestedBudget={campaign.requested_budget}
                  showLabel
                  className="max-w-xs"
                />
              }
            />
          )}
          <DetailRow
            label="Periode"
            value={
              campaign.start_date && campaign.end_date
                ? `${formatDate(campaign.start_date)} — ${formatDate(campaign.end_date)}`
                : null
            }
          />
        </dl>
      </div>

      {/* Realizations section */}
      {showRealizationsSection && (
        <RealizationsSection
          campaign={campaign}
          realizations={realizations}
          canAddRealization={canAddRealization}
          canSubmitKlaim={canSubmitKlaim}
          canMarkPaid={canMarkPaid}
          canMarkCompleted={canMarkCompleted}
          unfulfilledClaimDocs={unfulfilledClaimDocs}
        />
      )}

      {/* Claim checklist */}
      {claimDocuments.length > 0 && (
        <ClaimChecklistSection
          campaignId={campaign.id}
          campaignStatus={campaign.status}
          userRole={userRole}
          documents={claimDocuments}
        />
      )}

      {/* Files */}
      {files.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/2 p-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
            Dokumen
          </h2>
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id}>
                <SignedFileLink fileId={f.id} fileName={f.file_name} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Distributor receipt history */}
      {distributorReceipts.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/2 p-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Riwayat Penerimaan
          </h2>
          <ol className="space-y-4">
            {distributorReceipts.map((receipt, idx) => (
              <li key={receipt.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
                    <PackageCheck className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  {idx < distributorReceipts.length - 1 && (
                    <div className="w-px flex-1 bg-white/8 mt-1" />
                  )}
                </div>
                <div className="pb-4 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-200">
                      Diterima
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-400">
                      {receipt.receiver?.full_name ?? "—"}
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-500">
                      {formatDate(receipt.received_at)}
                    </span>
                  </div>
                  {receipt.notes && (
                    <p className="mt-1 text-sm text-slate-400 italic">
                      &ldquo;{receipt.notes}&rdquo;
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Approval history timeline */}
      {approvalHistory.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/2 p-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
            Riwayat Approval
          </h2>
          <ol className="space-y-4">
            {approvalHistory.map((entry, idx) => (
              <li key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/4">
                    {actionIconMap[entry.action] ?? (
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                    )}
                  </div>
                  {idx < approvalHistory.length - 1 && (
                    <div className="w-px flex-1 bg-white/8 mt-1" />
                  )}
                </div>
                <div className="pb-4 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-200">
                      {actionLabelMap[entry.action] ?? entry.action}
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-500">
                      {entry.actor?.full_name ?? "—"}
                    </span>
                    <span className="text-xs text-slate-500">·</span>
                    <span className="text-xs text-slate-500">
                      {formatDate(entry.created_at)}
                    </span>
                  </div>
                  {(entry.signature_image || entry.signature_text) && (
                    <div className="mt-2 space-y-1">
                      {entry.signature_image ? (
                        <>
                          <p className="text-xs text-slate-500">Tanda tangan:</p>
                          <div className="inline-block rounded border border-white/10 bg-slate-900 p-1">
                            <img
                              src={entry.signature_image}
                              alt="Tanda tangan"
                              className="max-h-16 max-w-[200px] object-contain"
                            />
                          </div>
                          {entry.signature_text && (
                            <p className="text-xs text-slate-500 italic">
                              {entry.signature_text}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Tanda tangan:{" "}
                          <span className="font-medium text-slate-300 italic">
                            {entry.signature_text}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                  {entry.comment && (
                    <p className="mt-1 text-sm text-slate-400 italic">
                      &ldquo;{entry.comment}&rdquo;
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Edit modal */}
      {isEditable && (
        <CampaignFormModal
          open={editOpen}
          onOpenChange={setEditOpen}
          initialData={initialFormData}
          existingFiles={files}
          departments={departments}
          brands={brands}
          regions={regions}
          channels={channels}
          categories={categories}
          actionApprovals={actionApprovals}
          vendors={vendors}
          masterBudgets={masterBudgets}
        />
      )}
    </div>
  );
}

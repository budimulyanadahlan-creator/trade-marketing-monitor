"use client";

import { Fragment, useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveActionApprovalAction, deleteActionApprovalAction } from "@/app/actions/action-approvals";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, ChevronRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatIDR } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import { getStatusConfig, groupCampaignsByCommitment } from "@/lib/campaign-status";
import type { CampaignStatus } from "@/types/database";

type MasterBudgetOption = {
  id: string;
  fiscal_year: number;
  quarter: number;
  promotion_category: { name: string } | null;
};

type BrandOption = { id: string; name: string };

type AACampaign = {
  id: string;
  name: string;
  requested_budget: number | null;
  status: CampaignStatus;
  brand: { name: string } | null;
  region: { name: string } | null;
};

type ActionApprovalWithJoins = {
  id: string;
  name: string;
  master_budget_id: string | null;
  brand_id: string | null;
  start_date: string;
  end_date: string;
  target_budget: number;
  budget_tersisa: number;
  created_at: string;
  master_budget: {
    id: string;
    fiscal_year: number;
    quarter: number;
    promotion_category: { name: string } | null;
  } | null;
  brand: { name: string } | null;
};

function ActionApprovalDialog({
  actionApproval,
  trigger,
  masterBudgets,
  brands,
}: {
  actionApproval: ActionApprovalWithJoins | null;
  trigger: React.ReactNode;
  masterBudgets: MasterBudgetOption[];
  brands: BrandOption[];
}) {
  const isEdit = actionApproval !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveActionApprovalAction, {});
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Action Approval diperbarui" : "Action Approval ditambahkan");
      setOpen(false);
      router.refresh();
    }
  }, [state.success, isEdit, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Action Approval" : "Tambah Action Approval"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {actionApproval && <input type="hidden" name="id" value={actionApproval.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="aa-name">Nama Action Approval</Label>
            <Input
              id="aa-name"
              name="name"
              defaultValue={actionApproval?.name ?? ""}
              placeholder="Contoh: Action Approval Q1 2025"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aa-budget">Master Budget</Label>
            <Select
              id="aa-budget"
              name="master_budget_id"
              defaultValue={actionApproval?.master_budget_id ?? ""}
              disabled={isPending}
            >
              <option value="">— Pilih Master Budget —</option>
              {masterBudgets.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.promotion_category?.name} — FY{mb.fiscal_year} Q{mb.quarter}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aa-brand">Brand</Label>
            <Select
              id="aa-brand"
              name="brand_id"
              defaultValue={actionApproval?.brand_id ?? ""}
              disabled={isPending}
            >
              <option value="">— Pilih Brand —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tanggal Mulai</Label>
              <DatePicker
                name="start_date"
                defaultValue={actionApproval?.start_date ?? ""}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal Selesai</Label>
              <DatePicker
                name="end_date"
                defaultValue={actionApproval?.end_date ?? ""}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="aa-target">Target Budget (IDR)</Label>
            <Input
              id="aa-target"
              name="target_budget"
              type="number"
              min="0"
              step="1000"
              defaultValue={actionApproval?.target_budget ?? 0}
              required
              disabled={isPending}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Simpan"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteActionApprovalAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Action Approval dihapus");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50"
        >
          <Trash2 className="h-3 w-3" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Action Approval</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus action approval{" "}
          <span className="font-medium text-slate-200">{name}</span>? Tindakan
          ini tidak dapat dibatalkan.
        </p>
        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignGroup({
  title,
  campaigns,
  subtotal,
}: {
  title: string;
  campaigns: AACampaign[];
  subtotal: number;
}) {
  return (
    <div className="rounded-lg border border-white/8 overflow-hidden">
      <div className="flex items-center justify-between bg-white/4 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {title} ({campaigns.length})
        </span>
        <span className="text-xs font-medium text-slate-300">
          Subtotal: {formatIDR(subtotal)}
        </span>
      </div>
      {campaigns.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Nama Campaign</th>
              <th className="px-4 py-2 font-medium">Brand</th>
              <th className="px-4 py-2 font-medium">Region</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Requested Budget</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const statusCfg = getStatusConfig(c.status);
              return (
                <tr key={c.id} className="border-b border-white/6 last:border-b-0">
                  <td className="px-4 py-2 text-slate-200">{c.name}</td>
                  <td className="px-4 py-2 text-slate-400">{c.brand?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-400">{c.region?.name ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}
                    >
                      {statusCfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-300">
                    {formatIDR(c.requested_budget ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-3 text-sm text-slate-500">Tidak ada campaign.</p>
      )}
    </div>
  );
}

function AADrilldown({
  aa,
  campaigns,
}: {
  aa: ActionApprovalWithJoins;
  campaigns: AACampaign[];
}) {
  if (campaigns.length === 0) {
    return (
      <div className="px-6 py-6 text-center text-sm text-slate-500">
        Belum ada campaign terhubung.
      </div>
    );
  }

  const { committed, notCommitted, committedTotal, notCommittedTotal } =
    groupCampaignsByCommitment(campaigns);

  return (
    <div className="space-y-3 px-6 py-4">
      <CampaignGroup
        title="Memotong budget"
        campaigns={committed}
        subtotal={committedTotal}
      />
      <CampaignGroup
        title="Tidak memotong budget"
        campaigns={notCommitted}
        subtotal={notCommittedTotal}
      />
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 rounded-lg border border-white/8 bg-white/4 px-4 py-2.5 text-sm">
        <span className="text-slate-400">Target Budget</span>
        <span className="font-medium text-slate-200">{formatIDR(aa.target_budget)}</span>
        <span className="text-slate-500">−</span>
        <span className="text-slate-400">Subtotal Komitmen</span>
        <span className="font-medium text-slate-200">{formatIDR(committedTotal)}</span>
        <span className="text-slate-500">=</span>
        <span className="text-slate-400">Budget Tersisa</span>
        <span className={`font-semibold ${budgetTersisaClass(aa)}`}>
          {formatIDR(aa.target_budget - committedTotal)}
        </span>
      </div>
    </div>
  );
}

function budgetTersisaClass(aa: ActionApprovalWithJoins) {
  return aa.budget_tersisa < 0
    ? "text-rose-400"
    : aa.budget_tersisa <= aa.target_budget * 0.2
    ? "text-amber-400"
    : "text-emerald-400";
}

export function ActionApprovalsTable({
  actionApprovals,
  masterBudgets,
  brands,
  campaignsByAA,
}: {
  actionApprovals: ActionApprovalWithJoins[];
  masterBudgets: MasterBudgetOption[];
  brands: BrandOption[];
  campaignsByAA: Record<string, AACampaign[]>;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{actionApprovals.length} action approval terdaftar</p>
        <ActionApprovalDialog
          actionApproval={null}
          masterBudgets={masterBudgets}
          brands={brands}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Action Approval
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead>Nama Action Approval</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Periode</TableHead>
              <TableHead>Target Budget</TableHead>
              <TableHead>Budget Tersisa AA</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actionApprovals.length > 0 ? (
              actionApprovals.map((aa) => {
                const isExpanded = expandedIds.has(aa.id);
                return (
                  <Fragment key={aa.id}>
                    <TableRow>
                      <TableCell className="pr-0">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(aa.id)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Tutup" : "Lihat"} rincian campaign ${aa.name}`}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-white/8 hover:text-slate-200"
                        >
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          />
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{aa.name}</TableCell>
                      <TableCell className="text-slate-400">
                        {aa.brand?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {formatDate(aa.start_date)} — {formatDate(aa.end_date)}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {formatIDR(aa.target_budget)}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(aa.id)}
                          className={`cursor-pointer underline-offset-4 hover:underline ${budgetTersisaClass(aa)} ${
                            aa.budget_tersisa <= aa.target_budget * 0.2 ? "font-medium" : ""
                          }`}
                        >
                          {formatIDR(aa.budget_tersisa)}
                        </button>
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {formatDate(aa.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ActionApprovalDialog
                            actionApproval={aa}
                            masterBudgets={masterBudgets}
                            brands={brands}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Pencil className="h-3 w-3" />
                                Edit
                              </Button>
                            }
                          />
                          <DeleteButton id={aa.id} name={aa.name} />
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="border-white/8 bg-white/2 hover:bg-white/2">
                        <TableCell colSpan={8} className="p-0">
                          <AADrilldown
                            aa={aa}
                            campaigns={campaignsByAA[aa.id] ?? []}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-12 text-slate-500"
                >
                  Belum ada Action Approval. Tambah Action Approval pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

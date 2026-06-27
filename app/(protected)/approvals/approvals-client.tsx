"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import {
  adminApproveCampaignAction,
  adminRejectCampaignAction,
} from "@/app/actions/approvals";
import type { SubmittedCampaign } from "./page";

export function ApprovalsClient({
  campaigns,
}: {
  campaigns: SubmittedCampaign[];
}) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<SubmittedCampaign | null>(null);
  const [aaReference, setAaReference] = useState("");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<SubmittedCampaign | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  function openApprove(item: SubmittedCampaign) {
    setApproveTarget(item);
    setAaReference("");
    setApproveOpen(true);
  }

  function openReject(item: SubmittedCampaign) {
    setRejectTarget(item);
    setRejectComment("");
    setRejectOpen(true);
  }

  async function handleApproveSubmit() {
    if (!approveTarget) return;
    setIsPending(true);
    const result = await adminApproveCampaignAction(approveTarget.id, aaReference);
    setIsPending(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("SKP berhasil disetujui");
      setApproveOpen(false);
      router.refresh();
    }
  }

  async function handleRejectSubmit() {
    if (!rejectTarget) return;
    setIsPending(true);
    const result = await adminRejectCampaignAction(rejectTarget.id, rejectComment);
    setIsPending(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("SKP ditolak");
      setRejectOpen(false);
      router.refresh();
    }
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-white/8 py-16 text-center">
        <p className="text-slate-500 text-sm">
          Tidak ada SKP yang menunggu persetujuan
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-white/8 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-white/2">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Nama SKP
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">
                Dept
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">
                Brand
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">
                Region
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">
                Diajukan
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">
                File
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/4">
            {campaigns.map((item) => (
              <tr key={item.id} className="hover:bg-white/2 transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/campaigns/${item.id}`}
                    className="text-slate-200 hover:text-emerald-400 transition-colors font-medium flex items-center gap-1"
                  >
                    {item.name}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-400 hidden md:table-cell">
                  {item.department?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-400 hidden md:table-cell">
                  {item.brand?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-400 hidden lg:table-cell">
                  {item.region?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                  {item.submitted_at ? formatDate(item.submitted_at) : "—"}
                </td>
                <td className="px-4 py-3 text-center text-slate-400 hidden sm:table-cell">
                  {item.campaign_files.length}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                      onClick={() => openApprove(item)}
                      disabled={isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline ml-1">Setujui</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                      onClick={() => openReject(item)}
                      disabled={isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline ml-1">Tolak</span>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Approve dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Setujui SKP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {approveTarget && (
              <p className="text-sm text-slate-400">
                Menyetujui:{" "}
                <span className="font-medium text-slate-200">
                  {approveTarget.name}
                </span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="aa-reference">
                Nomor AA Reference <span className="text-rose-400">*</span>
              </Label>
              <Input
                id="aa-reference"
                placeholder="Masukkan nomor AA Reference..."
                value={aaReference}
                onChange={(e) => setAaReference(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveOpen(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button
              onClick={handleApproveSubmit}
              disabled={isPending || !aaReference.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Setujui SKP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak SKP</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {rejectTarget && (
              <p className="text-sm text-slate-400">
                Menolak:{" "}
                <span className="font-medium text-slate-200">
                  {rejectTarget.name}
                </span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reject-comment">
                Alasan Penolakan <span className="text-rose-400">*</span>
              </Label>
              <Textarea
                id="reject-comment"
                placeholder="Tuliskan alasan penolakan..."
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectSubmit}
              disabled={isPending || !rejectComment.trim()}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tolak SKP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

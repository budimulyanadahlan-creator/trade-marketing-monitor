"use client";

import { useActionState, useState } from "react";
import { AlertCircle, ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateEventStatusAction, type UpdateEventState } from "@/app/actions/event";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_NOT_STARTED, EVENT_STATUS_LABELS } from "@/lib/event";
import { cn } from "@/lib/utils";
import type { EventStatus } from "@/types/database";

/** Status & realisasi terkini, sebagai nilai awal form. */
export type EventStatusValues = {
  id: string;
  status: EventStatus;
  start_date: string;
  actual_participants: number | null;
  actual_sales: number | null;
  actual_budget: number | null;
  cancel_reason: string | null;
};

const STATUSES: EventStatus[] = ["rencana", "terlaksana", "batal"];

const STATUS_HINTS: Record<EventStatus, string> = {
  rencana: "Untuk koreksi. Realisasi yang sudah diisi tetap tersimpan, tetapi tidak dihitung sebagai aktual.",
  terlaksana: "Wajib isi peserta aktual, hasil sales, dan realisasi budget event.",
  batal: "Wajib isi alasan batal. Realisasi budget boleh diisi jika ada biaya hangus (misalnya DP vendor).",
};

/**
 * Ubah status event + realisasi. `today` (YYYY-MM-DD, WIB) dari server
 * menentukan apakah Terlaksana boleh dipilih; aturan yang sama dicek ulang
 * di server action dan database.
 */
export function EventStatusDialog({ event, today }: { event: EventStatusValues; today: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EventStatus>(event.status);
  const notStarted = event.start_date > today;
  const [state, formAction, isPending] = useActionState(
    async (prev: UpdateEventState, formData: FormData) => {
      const result = await updateEventStatusAction(prev, formData);
      if (result.success) {
        toast.success(`Status diubah ke ${EVENT_STATUS_LABELS[status]}`);
        setOpen(false);
      }
      return result;
    },
    {}
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStatus(event.status);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <ClipboardCheck className="h-4 w-4" />
          Ubah Status
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Status & Realisasi</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={event.id} />
          <input type="hidden" name="status" value={status} />

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Status">
              {STATUSES.map((s) => {
                const disabled = isPending || (s === "terlaksana" && notStarted);
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setStatus(s)}
                    disabled={disabled}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      status === s
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {EVENT_STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              {notStarted && status !== "terlaksana" ? `${EVENT_NOT_STARTED}. ` : ""}
              {STATUS_HINTS[status]}
            </p>
          </div>

          {status === "terlaksana" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="evt-actual-participants">Peserta Aktual</Label>
                <Input
                  id="evt-actual-participants"
                  name="actual_participants"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={event.actual_participants ?? undefined}
                  required
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evt-actual-sales">Hasil Sales (Rp)</Label>
                <Input
                  id="evt-actual-sales"
                  name="actual_sales"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={event.actual_sales ?? undefined}
                  required
                  disabled={isPending}
                />
              </div>
            </div>
          )}

          {status === "batal" && (
            <div className="space-y-1.5">
              <Label htmlFor="evt-cancel-reason">Alasan Batal</Label>
              <Textarea
                id="evt-cancel-reason"
                name="cancel_reason"
                rows={3}
                defaultValue={event.cancel_reason ?? ""}
                required
                disabled={isPending}
              />
            </div>
          )}

          {status !== "rencana" && (
            <div className="space-y-1.5">
              <Label htmlFor="evt-actual-budget">
                Realisasi Budget Event (Rp)
                {status === "batal" && <span className="font-normal text-slate-500"> (opsional)</span>}
              </Label>
              <Input
                id="evt-actual-budget"
                name="actual_budget"
                type="number"
                min={0}
                step="any"
                defaultValue={event.actual_budget ?? undefined}
                required={status === "terlaksana"}
                disabled={isPending}
              />
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
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

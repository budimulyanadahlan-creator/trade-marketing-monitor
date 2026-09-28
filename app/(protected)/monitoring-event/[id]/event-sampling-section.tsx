"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteEventSamplingAction,
  saveEventSamplingAction,
  type SaveEventSamplingState,
} from "@/app/actions/event";
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
import { summarizeEventSampling } from "@/lib/event";
import { cn, formatIDR } from "@/lib/utils";

export type EventSamplingItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit: string;
  value: number;
};

const formatQty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

function SamplingFormDialog({
  eventId,
  sampling,
  trigger,
}: {
  eventId: string;
  sampling?: EventSamplingItem;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Remount form setiap dibuka agar nilai awal & error lama tidak tertinggal.
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, isPending] = useActionState(
    async (prev: SaveEventSamplingState, formData: FormData) => {
      const result = await saveEventSamplingAction(prev, formData);
      if (result.success) {
        toast.success(sampling ? "Baris sampling diubah" : "Baris sampling ditambahkan");
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
        if (next) setFormKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{sampling ? "Edit Sampling" : "Tambah Sampling"}</DialogTitle>
        </DialogHeader>

        <form key={formKey} action={formAction} className="space-y-4">
          <input type="hidden" name="event_id" value={eventId} />
          {sampling && <input type="hidden" name="id" value={sampling.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="smp-product">Nama Produk</Label>
            <Input
              id="smp-product"
              name="product_name"
              defaultValue={sampling?.product_name}
              required
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="smp-qty">Qty</Label>
              <Input
                id="smp-qty"
                name="quantity"
                type="number"
                min={0.01}
                step="any"
                defaultValue={sampling?.quantity}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smp-unit">Satuan</Label>
              <Input
                id="smp-unit"
                name="unit"
                placeholder="pcs, karton, pack"
                defaultValue={sampling?.unit}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smp-value">Nilai (Rp)</Label>
            <Input
              id="smp-value"
              name="value"
              type="number"
              min={0}
              step="any"
              defaultValue={sampling?.value}
              required
              disabled={isPending}
            />
          </div>

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

function DeleteSamplingButton({ eventId, sampling }: { eventId: string; sampling: EventSamplingItem }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteEventSamplingAction(eventId, sampling.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Baris sampling dihapus");
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400 hover:text-rose-300" aria-label="Hapus">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Sampling</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus baris <span className="font-medium text-slate-200">{sampling.product_name}</span>?
          Baris tetap tercatat di audit log.
        </p>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Batal
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rincian sampling per produk + total nilai dibandingkan rencana budget
 * sample. Tombol tambah/edit/hapus hanya untuk pemegang can_manage_posm().
 */
export function EventSamplingSection({
  eventId,
  samplings,
  plannedSampleBudget,
  canManage,
}: {
  eventId: string;
  samplings: EventSamplingItem[];
  plannedSampleBudget: number;
  canManage: boolean;
}) {
  const summary = summarizeEventSampling(samplings, plannedSampleBudget);
  const over = summary.remaining < 0;

  return (
    <section className="rounded-xl border border-white/8 bg-white/2 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-300">Rincian Sampling</h2>
        {canManage && (
          <SamplingFormDialog
            eventId={eventId}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4" />
                Tambah Sampling
              </Button>
            }
          />
        )}
      </div>

      {samplings.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-4 font-medium">Produk</th>
                <th className="py-2 pr-4 text-right font-medium">Qty</th>
                <th className="py-2 pr-4 font-medium">Satuan</th>
                <th className="py-2 pr-4 text-right font-medium">Nilai</th>
                {canManage && <th className="w-20 py-2" />}
              </tr>
            </thead>
            <tbody>
              {samplings.map((s) => (
                <tr key={s.id} className="border-b border-white/5 text-slate-200">
                  <td className="py-2 pr-4">{s.product_name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatQty(s.quantity)}</td>
                  <td className="py-2 pr-4 text-slate-400">{s.unit}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatIDR(s.value)}</td>
                  {canManage && (
                    <td className="py-1 text-right">
                      <div className="flex justify-end gap-1">
                        <SamplingFormDialog
                          eventId={eventId}
                          sampling={s}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteSamplingButton eventId={eventId} sampling={s} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Belum ada rincian sampling.</p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-white/8 pt-4 sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Nilai Sampling</dt>
          <dd className="text-sm tabular-nums text-slate-200">{formatIDR(summary.total)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">Rencana Budget Sample</dt>
          <dd className="text-sm tabular-nums text-slate-200">{formatIDR(summary.planned)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {over ? "Melebihi Rencana" : "Sisa Rencana"}
          </dt>
          <dd className={cn("text-sm tabular-nums", over ? "text-rose-400" : "text-emerald-300")}>
            {formatIDR(Math.abs(summary.remaining))}
            {summary.percentOfPlan !== null && (
              <span className="ml-1.5 text-xs text-slate-500">
                ({summary.percentOfPlan.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% terpakai)
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

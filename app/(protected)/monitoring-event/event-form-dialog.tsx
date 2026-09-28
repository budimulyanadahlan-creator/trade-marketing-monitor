"use client";

import { useActionState, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createEventAction,
  updateEventAction,
  type CreateEventState,
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
import { Select } from "@/components/ui/select";
import { EVENT_TYPES } from "@/lib/event";
import type { EventType } from "@/types/database";

export type RegionOption = { id: string; name: string };

/** Nilai awal form edit (field Rencana). */
export type EventFormValues = {
  id: string;
  name: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  region_id: string;
  location: string;
  pic_name: string;
  target_participants: number;
  target_sales: number;
  planned_budget: number;
  planned_sample_budget: number;
};

/**
 * Form tambah (tanpa `event`) atau edit (dengan `event`) field Rencana.
 * `regions` = region aktif; region event lama yang sudah nonaktif ikut
 * dikirim pemanggil agar tetap bisa dipilih.
 */
export function EventFormDialog({
  regions,
  event,
  trigger,
}: {
  regions: RegionOption[];
  event?: EventFormValues;
  trigger: ReactNode;
}) {
  const isEdit = Boolean(event);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(event?.start_date ?? "");
  const [state, formAction, isPending] = useActionState(
    async (prev: CreateEventState, formData: FormData) => {
      const result = isEdit ? await updateEventAction(prev, formData) : await createEventAction(prev, formData);
      if (result.success) {
        toast.success(isEdit ? "Event diperbarui" : "Event ditambahkan");
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
        if (next) setStartDate(event?.start_date ?? "");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "Tambah Event"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {event && <input type="hidden" name="id" value={event.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="evt-name">Nama Event</Label>
              <Input
                id="evt-name"
                name="name"
                placeholder="Contoh: Senam Sehat Agustusan"
                defaultValue={event?.name}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-type">Jenis</Label>
              <Select
                id="evt-type"
                name="event_type"
                defaultValue={event?.event_type ?? ""}
                placeholder="Pilih jenis"
                required
                disabled={isPending}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-start">Tanggal Mulai</Label>
              <Input
                id="evt-start"
                name="start_date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                disabled={isPending}
              />
              <p className="text-xs text-slate-500">Kuartal event mengikuti tanggal mulai.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-end">Tanggal Selesai</Label>
              <Input
                id="evt-end"
                name="end_date"
                type="date"
                min={startDate || undefined}
                defaultValue={event?.end_date}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-region">Region</Label>
              <Select
                id="evt-region"
                name="region_id"
                defaultValue={event?.region_id ?? ""}
                placeholder="Pilih region"
                required
                disabled={isPending}
              >
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-pic">PIC</Label>
              <Input
                id="evt-pic"
                name="pic_name"
                placeholder="Nama PIC"
                defaultValue={event?.pic_name}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-location">Lokasi / Nama Outlet</Label>
            <Input
              id="evt-location"
              name="location"
              placeholder="Contoh: Lapangan Merdeka, Medan"
              defaultValue={event?.location}
              required
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-target-participants">Target Peserta</Label>
              <Input
                id="evt-target-participants"
                name="target_participants"
                type="number"
                min={0}
                step={1}
                defaultValue={event?.target_participants}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-target-sales">Target Sales (Rp)</Label>
              <Input
                id="evt-target-sales"
                name="target_sales"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.target_sales}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-budget">Rencana Budget Event (Rp)</Label>
              <Input
                id="evt-budget"
                name="planned_budget"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.planned_budget}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-sample-budget">Rencana Budget Sample (Rp)</Label>
              <Input
                id="evt-sample-budget"
                name="planned_sample_budget"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.planned_sample_budget}
                required
                disabled={isPending}
              />
            </div>
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

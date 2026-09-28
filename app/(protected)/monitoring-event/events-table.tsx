"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createEventAction, type CreateEventState } from "@/app/actions/event";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EVENT_STATUS_LABELS, EVENT_TYPES } from "@/lib/event";
import { formatDate, formatIDR } from "@/lib/utils";
import type { EventRow, EventStatus } from "@/types/database";

export type EventListRow = Pick<
  EventRow,
  | "id"
  | "name"
  | "event_type"
  | "start_date"
  | "end_date"
  | "location"
  | "pic_name"
  | "target_participants"
  | "target_sales"
  | "status"
> & {
  region_name: string | null;
  planned_budget: number | null;
  planned_sample_budget: number | null;
};

type RegionOption = { id: string; name: string };

const STATUS_VARIANT: Record<EventStatus, "secondary" | "default" | "destructive"> = {
  rencana: "secondary",
  terlaksana: "default",
  batal: "destructive",
};

function formatDateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

// ---- Add Dialog ----

function AddEventDialog({ regions }: { regions: RegionOption[] }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [state, formAction, isPending] = useActionState(
    async (prev: CreateEventState, formData: FormData) => {
      const result = await createEventAction(prev, formData);
      if (result.success) {
        toast.success("Event ditambahkan");
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
        if (next) setStartDate("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Tambah Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah Event</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
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
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-type">Jenis</Label>
              <Select
                id="evt-type"
                name="event_type"
                defaultValue=""
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
                defaultValue=""
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
              <Input id="evt-pic" name="pic_name" placeholder="Nama PIC" required disabled={isPending} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-location">Lokasi / Nama Outlet</Label>
            <Input
              id="evt-location"
              name="location"
              placeholder="Contoh: Lapangan Merdeka, Medan"
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

// ---- Main Table ----

export function EventsTable({
  events,
  regions,
  canManage,
  periodLabel,
}: {
  events: EventListRow[];
  regions: RegionOption[];
  canManage: boolean;
  periodLabel: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          {events.length} event di {periodLabel}
        </p>
        {canManage && <AddEventDialog regions={regions} />}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Tanggal</TableHead>
              <TableHead>Nama Event</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>PIC</TableHead>
              <TableHead className="text-right">Target Peserta</TableHead>
              <TableHead className="text-right">Target Sales</TableHead>
              <TableHead className="text-right">Budget Event</TableHead>
              <TableHead className="text-right">Budget Sample</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length > 0 ? (
              events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-slate-300 whitespace-nowrap">
                    {formatDateRange(e.start_date, e.end_date)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>{e.name}</div>
                    <div className="text-xs text-slate-500">{e.event_type}</div>
                  </TableCell>
                  <TableCell className="text-slate-300">{e.region_name ?? "—"}</TableCell>
                  <TableCell className="text-slate-300">{e.location}</TableCell>
                  <TableCell className="text-slate-300">{e.pic_name}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.target_participants.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">{formatIDR(e.target_sales)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.planned_budget === null ? "—" : formatIDR(e.planned_budget)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.planned_sample_budget === null ? "—" : formatIDR(e.planned_sample_budget)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                  Belum ada event di {periodLabel}.
                  {canManage && " Tambah event pertama lewat tombol Tambah Event."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

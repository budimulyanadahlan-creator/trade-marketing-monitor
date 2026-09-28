"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEventAction } from "@/app/actions/event";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EventFormDialog, type EventFormOptions, type EventFormValues } from "../event-form-dialog";
import { EventStatusDialog, type EventStatusValues } from "./event-status-dialog";

function DeleteEventButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteEventAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Event dihapus");
        setOpen(false);
        router.push("/monitoring-event");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50">
          <Trash2 className="h-4 w-4" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Event</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus event <span className="font-medium text-slate-200">{name}</span>? Event akan
          hilang dari tabel dan detail, tetapi tetap tercatat di audit log.
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

/** Tombol Ubah Status, Edit & Hapus, hanya dirender untuk pemegang can_manage_posm(). */
export function EventDetailActions({
  event,
  status,
  options,
  today,
}: {
  event: EventFormValues;
  status: EventStatusValues;
  options: EventFormOptions;
  today: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <EventStatusDialog event={status} today={today} />
      <EventFormDialog
        event={event}
        options={options}
        trigger={
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        }
      />
      <DeleteEventButton id={event.id} name={event.name} />
    </div>
  );
}

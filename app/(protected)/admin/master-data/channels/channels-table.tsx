"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { saveChannelAction, toggleChannelActiveAction, deleteChannelAction } from "@/app/actions/master-data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ChannelRow } from "@/types/database";

function ChannelDialog({
  channel,
  trigger,
}: {
  channel: ChannelRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = channel !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveChannelAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Channel diperbarui" : "Channel ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Channel" : "Tambah Channel"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {channel && <input type="hidden" name="id" value={channel.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Nama Channel</Label>
            <Input
              id="channel-name"
              name="name"
              defaultValue={channel?.name ?? ""}
              placeholder="Contoh: GT"
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

function ToggleActiveButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(isActive);

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleChannelActiveAction(id, !current);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrent(!current);
        toast.success(current ? "Channel dinonaktifkan" : "Channel diaktifkan");
      }
    });
  }

  return (
    <Button
      variant={current ? "destructive" : "outline"}
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : current ? (
        "Nonaktifkan"
      ) : (
        "Aktifkan"
      )}
    </Button>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteChannelAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Channel dihapus");
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50">
          <Trash2 className="h-3 w-3" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Channel</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus channel <span className="font-medium text-slate-200">{name}</span>? Tindakan ini tidak dapat dibatalkan.
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

export function ChannelsTable({ channels }: { channels: ChannelRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{channels.length} channel terdaftar</p>
        <ChannelDialog
          channel={null}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Channel
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.length > 0 ? (
              channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell className="font-medium">{channel.name}</TableCell>
                  <TableCell>
                    <Badge variant={channel.is_active ? "default" : "outline"}>
                      {channel.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <ChannelDialog
                        channel={channel}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={channel.id} isActive={channel.is_active} />
                      {!channel.is_active && <DeleteButton id={channel.id} name={channel.name} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-12 text-slate-500">
                  Belum ada channel.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

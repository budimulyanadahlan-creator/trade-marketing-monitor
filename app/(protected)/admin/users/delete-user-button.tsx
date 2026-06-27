"use client";

import { useState, useTransition } from "react";
import { deleteUserAction } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
  userName: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function DeleteUserButton({ userId, userName, disabled, disabledReason }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteUserAction(userId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`User ${userName} berhasil dihapus`);
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          title={disabledReason}
          className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50"
        >
          <Trash2 className="h-3 w-3" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus User</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus user{" "}
          <span className="font-medium text-slate-200">{userName}</span>? Akun
          login dan semua data user ini akan dihapus permanen.
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

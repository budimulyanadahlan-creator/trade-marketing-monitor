"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import {
  saveDistributorAction,
  toggleDistributorActiveAction,
  deleteDistributorAction,
} from "@/app/actions/master-data";
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
import { SearchInput } from "@/components/ui/search-input";
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
import { formatDate } from "@/lib/utils";
import { filterBySearch } from "@/lib/search";
import type { DistributorRow } from "@/types/database";

function DistributorDialog({
  distributor,
  trigger,
}: {
  distributor: DistributorRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = distributor !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveDistributorAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Distributor diperbarui" : "Distributor ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Distributor" : "Tambah Distributor"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {distributor && <input type="hidden" name="id" value={distributor.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="distributor-name">Nama Distributor</Label>
            <Input
              id="distributor-name"
              name="name"
              defaultValue={distributor?.name ?? ""}
              placeholder="Contoh: PT Distribusi Nusantara"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="distributor-contact">Kontak</Label>
            <Input
              id="distributor-contact"
              name="contact"
              defaultValue={distributor?.contact ?? ""}
              placeholder="No. telepon atau email"
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
      const result = await toggleDistributorActiveAction(id, !current);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrent(!current);
        toast.success(current ? "Distributor dinonaktifkan" : "Distributor diaktifkan");
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
      const result = await deleteDistributorAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Distributor dihapus");
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
          <DialogTitle>Hapus Distributor</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus distributor <span className="font-medium text-slate-200">{name}</span>? Tindakan ini tidak dapat dibatalkan.
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

export function DistributorsTable({ distributors }: { distributors: DistributorRow[] }) {
  const [query, setQuery] = useState("");
  const filteredDistributors = useMemo(
    () => filterBySearch(distributors, query, (d) => [d.name]),
    [distributors, query]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">{filteredDistributors.length} distributor terdaftar</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari nama distributor..."
            className="w-64"
          />
          <DistributorDialog
            distributor={null}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Distributor
              </Button>
            }
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Distributor</TableHead>
              <TableHead>Kontak</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDistributors.length > 0 ? (
              filteredDistributors.map((distributor) => (
                <TableRow key={distributor.id}>
                  <TableCell className="font-medium">{distributor.name}</TableCell>
                  <TableCell className="text-slate-400">
                    {distributor.contact ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={distributor.is_active ? "default" : "outline"}>
                      {distributor.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {formatDate(distributor.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <DistributorDialog
                        distributor={distributor}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={distributor.id} isActive={distributor.is_active} />
                      {!distributor.is_active && (
                        <DeleteButton id={distributor.id} name={distributor.name} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                  {query.trim() ? (
                    <>Tidak ada hasil untuk &ldquo;{query.trim()}&rdquo;</>
                  ) : (
                    "Belum ada distributor. Tambah distributor pertama Anda."
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

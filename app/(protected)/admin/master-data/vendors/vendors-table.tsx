"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { saveVendorAction, toggleVendorActiveAction, deleteVendorAction } from "@/app/actions/master-data";
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
import { formatDate } from "@/lib/utils";
import type { VendorRow } from "@/types/database";

function VendorDialog({
  vendor,
  trigger,
}: {
  vendor: VendorRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = vendor !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveVendorAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Vendor diperbarui" : "Vendor ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Vendor" : "Tambah Vendor"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {vendor && <input type="hidden" name="id" value={vendor.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="vendor-name">Nama Vendor</Label>
            <Input
              id="vendor-name"
              name="name"
              defaultValue={vendor?.name ?? ""}
              placeholder="Contoh: PT Maju Bersama"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vendor-contact">Kontak</Label>
            <Input
              id="vendor-contact"
              name="contact"
              defaultValue={vendor?.contact ?? ""}
              placeholder="No. telepon atau email"
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vendor-category">Kategori Layanan</Label>
            <Input
              id="vendor-category"
              name="service_category"
              defaultValue={vendor?.service_category ?? ""}
              placeholder="Contoh: Event Organizer"
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
      const result = await toggleVendorActiveAction(id, !current);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrent(!current);
        toast.success(current ? "Vendor dinonaktifkan" : "Vendor diaktifkan");
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
      const result = await deleteVendorAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Vendor dihapus");
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
          <DialogTitle>Hapus Vendor</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus vendor <span className="font-medium text-slate-200">{name}</span>? Tindakan ini tidak dapat dibatalkan.
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

export function VendorsTable({ vendors }: { vendors: VendorRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{vendors.length} vendor terdaftar</p>
        <VendorDialog
          vendor={null}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Vendor
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Vendor</TableHead>
              <TableHead>Kontak</TableHead>
              <TableHead>Kategori Layanan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.length > 0 ? (
              vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell className="text-slate-400">
                    {vendor.contact ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-400">
                    {vendor.service_category ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={vendor.is_active ? "default" : "outline"}>
                      {vendor.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {formatDate(vendor.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <VendorDialog
                        vendor={vendor}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={vendor.id} isActive={vendor.is_active} />
                      {!vendor.is_active && <DeleteButton id={vendor.id} name={vendor.name} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-slate-500">
                  Belum ada vendor. Tambah vendor pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { saveBrandAction, toggleBrandActiveAction, deleteBrandAction } from "@/app/actions/master-data";
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
import type { BrandRow } from "@/types/database";

// ---- Add / Edit Dialog ----

function BrandDialog({
  brand,
  trigger,
}: {
  brand: BrandRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = brand !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveBrandAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Brand diperbarui" : "Brand ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Brand" : "Tambah Brand"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {brand && <input type="hidden" name="id" value={brand.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Nama Brand</Label>
            <Input
              id="brand-name"
              name="name"
              defaultValue={brand?.name ?? ""}
              placeholder="Contoh: Produk A"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-code">Kode Brand</Label>
            <Input
              id="brand-code"
              name="code"
              defaultValue={brand?.code ?? ""}
              placeholder="Contoh: PRODA"
              required
              disabled={isPending}
              className="uppercase"
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

// ---- Toggle Active Button ----

function ToggleActiveButton({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(isActive);

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleBrandActiveAction(id, !current);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrent(!current);
        toast.success(current ? "Brand dinonaktifkan" : "Brand diaktifkan");
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

// ---- Delete Button ----

function DeleteButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteBrandAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Brand dihapus");
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
          <DialogTitle>Hapus Brand</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus brand <span className="font-medium text-slate-200">{name}</span>? Tindakan ini tidak dapat dibatalkan.
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

// ---- Main Table ----

export function BrandsTable({ brands }: { brands: BrandRow[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{brands.length} brand terdaftar</p>
        <BrandDialog
          brand={null}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Brand
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Brand</TableHead>
              <TableHead>Kode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.length > 0 ? (
              brands.map((brand) => (
                <TableRow key={brand.id}>
                  <TableCell className="font-medium">{brand.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                      {brand.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={brand.is_active ? "default" : "outline"}>
                      {brand.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {formatDate(brand.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <BrandDialog
                        brand={brand}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={brand.id} isActive={brand.is_active} />
                      {!brand.is_active && <DeleteButton id={brand.id} name={brand.name} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-slate-500">
                  Belum ada brand. Tambah brand pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

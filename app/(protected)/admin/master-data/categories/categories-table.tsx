"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  savePromotionCategoryAction,
  togglePromotionCategoryActiveAction,
  deletePromotionCategoryAction,
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
import { Select } from "@/components/ui/select";
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
import type { PromotionCategoryRow } from "@/types/database";

function CategoryDialog({
  category,
  trigger,
}: {
  category: PromotionCategoryRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = category !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    savePromotionCategoryAction,
    {}
  );

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Kategori diperbarui" : "Kategori ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Kategori Promosi" : "Tambah Kategori Promosi"}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {category && <input type="hidden" name="id" value={category.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Nama Kategori</Label>
            <Input
              id="cat-name"
              name="name"
              defaultValue={category?.name ?? ""}
              placeholder="Contoh: Trade Promo 1"
              required
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-type">Tipe</Label>
              <Select
                id="cat-type"
                name="type"
                defaultValue={category?.type ?? "TP"}
                required
                disabled={isPending}
              >
                <option value="TP">TP (Trade Promo)</option>
                <option value="CP">CP (Consumer Promo)</option>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-code">Kode Akun</Label>
              <Input
                id="cat-code"
                name="account_code"
                defaultValue={category?.account_code ?? ""}
                placeholder="Contoh: TP1"
                required
                disabled={isPending}
              />
            </div>
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
      const result = await togglePromotionCategoryActiveAction(id, !current);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrent(!current);
        toast.success(current ? "Kategori dinonaktifkan" : "Kategori diaktifkan");
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
      const result = await deletePromotionCategoryAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Kategori dihapus");
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
          <DialogTitle>Hapus Kategori</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus kategori <span className="font-medium text-slate-200">{name}</span>? Tindakan ini tidak dapat dibatalkan.
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

export function CategoriesTable({
  categories,
}: {
  categories: PromotionCategoryRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {categories.length} kategori terdaftar
        </p>
        <CategoryDialog
          category={null}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Kategori
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Kategori</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>Kode Akun</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length > 0 ? (
              categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={cat.type === "TP" ? "default" : "secondary"}
                    >
                      {cat.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                      {cat.account_code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={cat.is_active ? "default" : "outline"}>
                      {cat.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">
                    {formatDate(cat.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <CategoryDialog
                        category={cat}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={cat.id} isActive={cat.is_active} />
                      {!cat.is_active && <DeleteButton id={cat.id} name={cat.name} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-slate-500"
                >
                  Belum ada kategori promosi. Tambah kategori pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

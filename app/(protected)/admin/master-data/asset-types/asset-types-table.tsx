"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import {
  saveAssetTypeAction,
  toggleAssetTypeActiveAction,
  deleteAssetTypeAction,
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
import type { AssetTypeRow } from "@/types/database";

export type AssetTypeListRow = Pick<AssetTypeRow, "id" | "name" | "is_active" | "created_at"> & {
  /** Jumlah asset yang memakai jenis ini, termasuk yang sudah dihapus. */
  asset_count: number;
};

// ---- Add / Edit Dialog ----

function AssetTypeDialog({
  assetType,
  trigger,
}: {
  assetType: AssetTypeListRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = assetType !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveAssetTypeAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Jenis asset diperbarui" : "Jenis asset ditambahkan");
      setOpen(false);
    }
  }, [state, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Ubah Nama Jenis Asset" : "Tambah Jenis Asset"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {assetType && <input type="hidden" name="id" value={assetType.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="asset-type-name">Nama Jenis</Label>
            <Input
              id="asset-type-name"
              name="name"
              defaultValue={assetType?.name ?? ""}
              placeholder="Contoh: Seragam/Pakaian"
              required
              disabled={isPending}
            />
            {isEdit && (
              <p className="text-xs text-slate-500">
                Nama baru langsung berlaku di semua asset, filter, ringkasan, dan export.
              </p>
            )}
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

function ToggleActiveButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleAssetTypeActiveAction(id, !isActive);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(isActive ? "Jenis asset dinonaktifkan" : "Jenis asset diaktifkan");
      }
    });
  }

  return (
    <Button
      variant={isActive ? "destructive" : "outline"}
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isActive ? (
        "Nonaktifkan"
      ) : (
        "Aktifkan"
      )}
    </Button>
  );
}

// ---- Delete Button ----

function DeleteButton({ assetType }: { assetType: AssetTypeListRow }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inUse = assetType.asset_count > 0;

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAssetTypeAction(assetType.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Jenis asset dihapus");
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
          <DialogTitle>Hapus Jenis Asset</DialogTitle>
        </DialogHeader>
        {inUse ? (
          <p className="text-sm text-slate-400">
            Jenis <span className="font-medium text-slate-200">{assetType.name}</span> sudah dipakai{" "}
            {assetType.asset_count} asset sehingga tidak bisa dihapus. Nonaktifkan saja agar tidak
            muncul di form Daftarkan/Edit Asset.
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            Yakin ingin menghapus jenis <span className="font-medium text-slate-200">{assetType.name}</span>?
          </p>
        )}
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {inUse ? "Tutup" : "Batal"}
          </Button>
          {!inUse && (
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main Table ----

export function AssetTypesTable({ assetTypes }: { assetTypes: AssetTypeListRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterBySearch(assetTypes, query, (t) => [t.name]),
    [assetTypes, query]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">{filtered.length} jenis asset terdaftar</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari jenis asset..."
            className="w-64"
          />
          <AssetTypeDialog
            assetType={null}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Jenis
              </Button>
            }
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama Jenis</TableHead>
              <TableHead className="text-right">Dipakai Asset</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {t.asset_count.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "default" : "outline"}>
                      {t.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs">{formatDate(t.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <AssetTypeDialog
                        assetType={t}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Ubah Nama
                          </Button>
                        }
                      />
                      <ToggleActiveButton id={t.id} isActive={t.is_active} />
                      <DeleteButton assetType={t} />
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
                    "Belum ada jenis asset."
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

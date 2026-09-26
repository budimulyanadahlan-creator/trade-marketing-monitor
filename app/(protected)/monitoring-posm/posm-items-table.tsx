"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import {
  deletePosmItemAction,
  savePosmItemAction,
  togglePosmItemActiveAction,
  type SavePosmItemState,
} from "@/app/actions/posm";
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
import { filterBySearch } from "@/lib/search";
import { POSM_CATEGORIES, POSM_UNITS, type PosmStockStatus } from "@/lib/posm";
import { formatDate } from "@/lib/utils";
import { STOCK_STATUS_LABELS, StockStatusBadge } from "./stock-status-badge";
import type { PosmItemRow } from "@/types/database";

export type PosmItemListRow = Pick<
  PosmItemRow,
  "id" | "code" | "name" | "brand_id" | "category" | "unit" | "min_stock" | "is_active"
> & {
  brand_name: string | null;
  balance: number;
  stock_status: PosmStockStatus;
  last_movement_date: string | null;
  has_movements: boolean;
};

type BrandOption = { id: string; name: string; is_active: boolean };

type StatusFilter = "active" | "inactive" | "all";

// ---- Add / Edit Dialog ----

function PosmItemDialog({
  item,
  brands,
  suggestedCode,
  trigger,
}: {
  item: PosmItemListRow | null;
  brands: BrandOption[];
  suggestedCode: string;
  trigger: React.ReactNode;
}) {
  const isEdit = item !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (prev: SavePosmItemState, formData: FormData) => {
      const result = await savePosmItemAction(prev, formData);
      if (result.success) {
        toast.success(isEdit ? "Item POSM diperbarui" : "Item POSM ditambahkan");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  // Brand nonaktif tetap ditampilkan jika sedang dipakai item ini.
  const brandOptions = brands.filter((b) => b.is_active || b.id === item?.brand_id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Item POSM" : "Tambah Item POSM"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {item && <input type="hidden" name="id" value={item.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="posm-code">Kode</Label>
              <Input
                id="posm-code"
                name="code"
                defaultValue={item?.code ?? suggestedCode}
                required
                disabled={isPending}
                className="uppercase"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="posm-name">Nama Item</Label>
              <Input
                id="posm-name"
                name="name"
                defaultValue={item?.name ?? ""}
                placeholder="Contoh: Wobbler Promo Lebaran"
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="posm-brand">Brand (opsional)</Label>
            <Select id="posm-brand" name="brand_id" defaultValue={item?.brand_id ?? ""} disabled={isPending}>
              <option value="">— Tanpa brand —</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="posm-category">Kategori</Label>
              <Select
                id="posm-category"
                name="category"
                defaultValue={item?.category ?? ""}
                placeholder="Pilih kategori"
                required
                disabled={isPending}
              >
                {POSM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="posm-unit">Satuan</Label>
              <Select
                id="posm-unit"
                name="unit"
                defaultValue={item?.unit ?? "pcs"}
                required
                disabled={isPending}
              >
                {POSM_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="posm-min-stock">Stok Minimum (opsional)</Label>
            <Input
              id="posm-min-stock"
              name="min_stock"
              type="number"
              min={0}
              step={1}
              defaultValue={item?.min_stock ?? ""}
              placeholder="Batas peringatan stok menipis"
              disabled={isPending}
            />
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

// ---- Toggle Active Button ----

function ToggleActiveButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = await togglePosmItemActiveAction(id, !isActive);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(isActive ? "Item dinonaktifkan" : "Item diaktifkan");
      }
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : isActive ? "Nonaktifkan" : "Aktifkan"}
    </Button>
  );
}

// ---- Delete Button ----

function DeleteButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePosmItemAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Item POSM dihapus");
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
          <DialogTitle>Hapus Item POSM</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus item <span className="font-medium text-slate-200">{label}</span>?
          Item yang tidak dipakai lagi sebaiknya dinonaktifkan saja.
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

export function PosmItemsTable({
  items,
  brands,
  canManage,
  suggestedCode,
}: {
  items: PosmItemListRow[];
  brands: BrandOption[];
  canManage: boolean;
  suggestedCode: string;
}) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [stockFilter, setStockFilter] = useState<PosmStockStatus | "">("");

  const filtered = useMemo(() => {
    const byFilters = items.filter(
      (item) =>
        (!brandFilter || item.brand_id === brandFilter) &&
        (!categoryFilter || item.category === categoryFilter) &&
        (!stockFilter || item.stock_status === stockFilter) &&
        (statusFilter === "all" || item.is_active === (statusFilter === "active"))
    );
    return filterBySearch(byFilters, query, (i) => [i.code, i.name, i.brand_name]);
  }, [items, query, brandFilter, categoryFilter, stockFilter, statusFilter]);

  // Hanya brand yang dipakai item yang relevan sebagai filter.
  const usedBrands = useMemo(() => {
    const used = new Set(items.map((i) => i.brand_id));
    return brands.filter((b) => used.has(b.id));
  }, [items, brands]);

  const hasFilter =
    query.trim() !== "" || brandFilter !== "" || categoryFilter !== "" || stockFilter !== "" || statusFilter !== "active";
  const colSpan = canManage ? 11 : 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">{filtered.length} item POSM</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari kode, nama, atau brand..."
            className="w-64"
          />
          <Select
            aria-label="Filter brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="h-9 w-40"
          >
            <option value="">Semua brand</option>
            {usedBrands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter kategori"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 w-40"
          >
            <option value="">Semua kategori</option>
            {POSM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter stok"
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as PosmStockStatus | "")}
            className="h-9 w-36"
          >
            <option value="">Semua stok</option>
            {(Object.keys(STOCK_STATUS_LABELS) as PosmStockStatus[]).map((s) => (
              <option key={s} value={s}>
                {STOCK_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-9 w-36"
          >
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
            <option value="all">Semua status</option>
          </Select>
          {canManage && (
            <PosmItemDialog
              item={null}
              brands={brands}
              suggestedCode={suggestedCode}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Tambah Item
                </Button>
              }
            />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Kode</TableHead>
              <TableHead>Nama Item</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Satuan</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Stok Min.</TableHead>
              <TableHead>Stok</TableHead>
              <TableHead>Terakhir Diperbarui</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{item.code}</code>
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/monitoring-posm/items/${item.id}`}
                      className="hover:text-emerald-300 hover:underline underline-offset-4"
                    >
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-400">{item.brand_name ?? "—"}</TableCell>
                  <TableCell className="text-slate-300">{item.category}</TableCell>
                  <TableCell className="text-slate-400">{item.unit}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-slate-100">
                    {item.balance.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-right text-slate-300 tabular-nums">
                    {item.min_stock ?? <span className="text-slate-600">—</span>}
                  </TableCell>
                  <TableCell>
                    <StockStatusBadge status={item.stock_status} />
                  </TableCell>
                  <TableCell className="text-slate-400 whitespace-nowrap">
                    {item.last_movement_date ? (
                      formatDate(item.last_movement_date)
                    ) : (
                      <span className="text-slate-600">Belum ada mutasi</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.is_active ? "default" : "outline"}>
                      {item.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <PosmItemDialog
                          item={item}
                          brands={brands}
                          suggestedCode={suggestedCode}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3 w-3" />
                              Edit
                            </Button>
                          }
                        />
                        <ToggleActiveButton id={item.id} isActive={item.is_active} />
                        {/* Item yang sudah punya mutasi hanya bisa dinonaktifkan. */}
                        {!item.has_movements && (
                          <DeleteButton id={item.id} label={`${item.code} — ${item.name}`} />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-slate-500">
                  {hasFilter
                    ? "Tidak ada item yang cocok dengan filter."
                    : canManage
                      ? "Belum ada item POSM. Tambah item pertama Anda."
                      : "Belum ada item POSM."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

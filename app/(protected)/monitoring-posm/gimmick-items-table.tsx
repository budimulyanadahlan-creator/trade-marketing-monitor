"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState, useTransition } from "react";
import {
  deleteGimmickItemAction,
  saveGimmickItemAction,
  toggleGimmickItemActiveAction,
  type SaveGimmickItemState,
} from "@/app/actions/gimmick";
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
import { distinctPrograms, formatPcsWithCartons, GIMMICK_CATEGORIES, GIMMICK_UNITS } from "@/lib/gimmick";
import type { PosmStockStatus } from "@/lib/posm";
import { formatDate, formatIDR } from "@/lib/utils";
import type { GimmickItemRow } from "@/types/database";
import { STOCK_STATUS_LABELS, StockStatusBadge } from "./stock-status-badge";

export type GimmickItemListRow = Pick<
  GimmickItemRow,
  | "id"
  | "code"
  | "name"
  | "brand_id"
  | "category"
  | "unit"
  | "pcs_per_carton"
  | "unit_cost"
  | "suggested_price"
  | "min_stock"
  | "program"
  | "is_active"
> & {
  brand_name: string | null;
  has_movements: boolean;
  balance: number;
  /** Saldo × harga pokok master terbaru. */
  stock_value: number;
  stock_status: PosmStockStatus;
  last_movement_date: string | null;
};

type BrandOption = { id: string; name: string; is_active: boolean };

type StatusFilter = "active" | "inactive" | "all";

// ---- Add / Edit Dialog ----

function GimmickItemDialog({
  item,
  brands,
  programs,
  suggestedCode,
  trigger,
}: {
  item: GimmickItemListRow | null;
  brands: BrandOption[];
  programs: string[];
  suggestedCode: string;
  trigger: React.ReactNode;
}) {
  const isEdit = item !== null;
  const [open, setOpen] = useState(false);
  const programListId = useId();
  const [state, formAction, isPending] = useActionState(
    async (prev: SaveGimmickItemState, formData: FormData) => {
      const result = await saveGimmickItemAction(prev, formData);
      if (result.success) {
        toast.success(isEdit ? "Item gimmick diperbarui" : "Item gimmick ditambahkan");
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Item Gimmick" : "Tambah Item Gimmick"}</DialogTitle>
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
              <Label htmlFor="gmk-code">Kode</Label>
              <Input
                id="gmk-code"
                name="code"
                defaultValue={item?.code ?? suggestedCode}
                required
                disabled={isPending}
                className="uppercase"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="gmk-name">Nama Item</Label>
              <Input
                id="gmk-name"
                name="name"
                defaultValue={item?.name ?? ""}
                placeholder="Contoh: Payung Wangzai"
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmk-brand">Brand (opsional)</Label>
              <Select id="gmk-brand" name="brand_id" defaultValue={item?.brand_id ?? ""} disabled={isPending}>
                <option value="">— Tanpa brand —</option>
                {brandOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmk-program">Program / Periode (opsional)</Label>
              <Input
                id="gmk-program"
                name="program"
                list={programListId}
                defaultValue={item?.program ?? ""}
                placeholder="Contoh: Imlek 2027"
                autoComplete="off"
                disabled={isPending}
              />
              <datalist id={programListId}>
                {programs.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmk-category">Kategori</Label>
              <Select
                id="gmk-category"
                name="category"
                defaultValue={item?.category ?? ""}
                placeholder="Pilih kategori"
                required
                disabled={isPending}
              >
                {GIMMICK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmk-unit">Satuan</Label>
              <Select id="gmk-unit" name="unit" defaultValue={item?.unit ?? "pcs"} required disabled={isPending}>
                {GIMMICK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmk-carton">Isi/Karton</Label>
              <Input
                id="gmk-carton"
                name="pcs_per_carton"
                type="number"
                min={1}
                step={1}
                defaultValue={item?.pcs_per_carton ?? ""}
                placeholder="Opsional"
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmk-cost">Harga Pokok / pcs (Rp)</Label>
              <Input
                id="gmk-cost"
                name="unit_cost"
                type="number"
                min={0}
                step="any"
                defaultValue={item?.unit_cost ?? ""}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gmk-price">Harga Jual Saran / pcs (opsional)</Label>
              <Input
                id="gmk-price"
                name="suggested_price"
                type="number"
                min={0}
                step="any"
                defaultValue={item?.suggested_price ?? ""}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gmk-min-stock">Stok Minimum (pcs, opsional)</Label>
            <Input
              id="gmk-min-stock"
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
      const result = await toggleGimmickItemActiveAction(id, !isActive);
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
      const result = await deleteGimmickItemAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Item gimmick dihapus");
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
          <DialogTitle>Hapus Item Gimmick</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus item <span className="font-medium text-slate-200">{label}</span>?
          Item yang programnya sudah lewat sebaiknya dinonaktifkan saja.
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
// Hanya dirender untuk pemegang can_manage_posm(), jadi aksi tulis selalu tampil.

export function GimmickItemsTable({
  items,
  brands,
  suggestedCode,
}: {
  items: GimmickItemListRow[];
  brands: BrandOption[];
  suggestedCode: string;
}) {
  const [query, setQuery] = useState("");
  const [programFilter, setProgramFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState<PosmStockStatus | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const programs = useMemo(() => distinctPrograms(items), [items]);

  const filtered = useMemo(() => {
    const byFilters = items.filter(
      (item) =>
        (!programFilter || item.program?.trim().toLowerCase() === programFilter.toLowerCase()) &&
        (!categoryFilter || item.category === categoryFilter) &&
        (!stockFilter || item.stock_status === stockFilter) &&
        (statusFilter === "all" || item.is_active === (statusFilter === "active"))
    );
    return filterBySearch(byFilters, query, (i) => [i.code, i.name, i.program, i.brand_name]);
  }, [items, query, programFilter, categoryFilter, stockFilter, statusFilter]);

  const hasFilter =
    query.trim() !== "" ||
    programFilter !== "" ||
    categoryFilter !== "" ||
    stockFilter !== "" ||
    statusFilter !== "active";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">{filtered.length} item gimmick</p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari kode, nama, atau program..."
            className="w-64"
          />
          <Select
            aria-label="Filter program"
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="h-9 w-40"
          >
            <option value="">Semua program</option>
            {programs.map((p) => (
              <option key={p} value={p}>
                {p}
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
            {GIMMICK_CATEGORIES.map((c) => (
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
          <GimmickItemDialog
            item={null}
            brands={brands}
            programs={programs}
            suggestedCode={suggestedCode}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Item
              </Button>
            }
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Kode</TableHead>
              <TableHead>Nama Item</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Harga Pokok</TableHead>
              <TableHead className="text-right">Nilai Stok</TableHead>
              <TableHead>Stok</TableHead>
              <TableHead>Terakhir Diperbarui</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
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
                      href={`/monitoring-posm/gimmick/items/${item.id}`}
                      className="hover:text-emerald-300 hover:underline underline-offset-4"
                    >
                      {item.name}
                    </Link>
                    {item.brand_name && <div className="text-xs text-slate-500">{item.brand_name}</div>}
                  </TableCell>
                  <TableCell className="text-slate-300">{item.program ?? <span className="text-slate-600">—</span>}</TableCell>
                  <TableCell className="text-slate-300">{item.category}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-slate-100 whitespace-nowrap">
                    {formatPcsWithCartons(item.balance, item.pcs_per_carton, item.unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">{formatIDR(item.unit_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-100">{formatIDR(item.stock_value)}</TableCell>
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
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <GimmickItemDialog
                        item={item}
                        brands={brands}
                        programs={programs}
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
                      {!item.has_movements && <DeleteButton id={item.id} label={`${item.code} — ${item.name}`} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-slate-500">
                  {hasFilter
                    ? "Tidak ada item yang cocok dengan filter."
                    : "Belum ada item gimmick. Tambah item pertama Anda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

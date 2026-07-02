"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveMasterBudgetAction,
  deleteMasterBudgetAction,
  saveBudgetAllocationAction,
  deleteBudgetAllocationAction,
} from "@/app/actions/master-budget";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { AlertCircle, Loader2, Pencil, Plus, Trash2, ListTree } from "lucide-react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/utils";
import type {
  MasterBudgetRow,
  BudgetAllocationRow,
  BrandRow,
  PromotionCategoryRow,
} from "@/types/database";

// ---- Types ----

type BudgetWithCategory = MasterBudgetRow & {
  promotion_categories: Pick<PromotionCategoryRow, "name" | "account_code"> | null;
};

type AllocationWithRefs = BudgetAllocationRow & {
  brands: Pick<BrandRow, "name"> | null;
};

// ---- Master Budget Dialog ----

function MasterBudgetDialog({
  budget,
  categories,
  trigger,
}: {
  budget: BudgetWithCategory | null;
  categories: PromotionCategoryRow[];
  trigger: React.ReactNode;
}) {
  const isEdit = budget !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveMasterBudgetAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Budget diperbarui" : "Budget ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  const activeCategories = categories.filter((c) => c.is_active);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Master Budget" : "Tambah Master Budget"}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {budget && <input type="hidden" name="id" value={budget.id} />}
          {isEdit && budget && (
            <input
              type="hidden"
              name="promotion_category_id"
              value={budget.promotion_category_id}
            />
          )}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mb-cat">Kategori Promosi</Label>
            <Select
              id="mb-cat"
              name="promotion_category_id"
              defaultValue={budget?.promotion_category_id ?? ""}
              required
              disabled={isPending || isEdit}
            >
              <option value="" disabled>— Pilih Kategori Promosi —</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.account_code}] {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mb-year">Tahun Fiskal</Label>
              <Input
                id="mb-year"
                name="fiscal_year"
                type="number"
                defaultValue={budget?.fiscal_year ?? new Date().getFullYear()}
                min={2020}
                max={2100}
                step={1}
                required
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mb-quarter">Quarter</Label>
              <Select
                id="mb-quarter"
                name="quarter"
                defaultValue={String(budget?.quarter ?? 1)}
                required
                disabled={isPending}
              >
                <option value="1">Q1 (Apr–Jun)</option>
                <option value="2">Q2 (Jul–Sep)</option>
                <option value="3">Q3 (Okt–Des)</option>
                <option value="4">Q4 (Jan–Mar)</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mb-amount">Total Budget (IDR)</Label>
            <Input
              id="mb-amount"
              name="total_amount"
              type="number"
              defaultValue={budget?.total_amount ?? 0}
              min={0}
              step={1}
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

// ---- Delete Budget Button ----

function DeleteBudgetButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Hapus master budget ini? Semua alokasi di dalamnya juga akan dihapus.")) return;
    startTransition(async () => {
      const result = await deleteMasterBudgetAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Budget dihapus");
      }
    });
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={isPending}
    >
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </Button>
  );
}

// ---- Allocation Dialog ----

function AllocationDialog({
  allocation,
  masterBudgetId,
  fiscalYear,
  brands,
  trigger,
}: {
  allocation: AllocationWithRefs | null;
  masterBudgetId: string;
  fiscalYear: number;
  brands: BrandRow[];
  trigger: React.ReactNode;
}) {
  const isEdit = allocation !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveBudgetAllocationAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Alokasi diperbarui" : "Alokasi ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Alokasi Budget" : "Tambah Alokasi Budget"}
          </DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {allocation && <input type="hidden" name="id" value={allocation.id} />}
          <input type="hidden" name="master_budget_id" value={masterBudgetId} />
          <input type="hidden" name="fiscal_year" value={fiscalYear} />

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="alloc-brand">Brand</Label>
            <Select
              id="alloc-brand"
              name="brand_id"
              defaultValue={allocation?.brand_id ?? ""}
              required
              disabled={isPending || isEdit}
              placeholder="Pilih brand"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="alloc-amount">Nominal Alokasi (IDR)</Label>
            <Input
              id="alloc-amount"
              name="allocated_amount"
              type="number"
              defaultValue={allocation?.allocated_amount ?? 0}
              min={0}
              step={1}
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

// ---- Delete Allocation Button ----

function DeleteAllocationButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Hapus alokasi ini?")) return;
    startTransition(async () => {
      const result = await deleteBudgetAllocationAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Alokasi dihapus");
      }
    });
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={isPending}
    >
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </Button>
  );
}

// ---- Allocations Dialog (view + manage per brand) ----

function AllocationsDialog({
  budget,
  allocations,
  brands,
}: {
  budget: BudgetWithCategory;
  allocations: AllocationWithRefs[];
  brands: BrandRow[];
}) {
  const [open, setOpen] = useState(false);
  const activeBrands = brands.filter((b) => b.is_active);
  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated_amount, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ListTree className="h-3 w-3" />
          Alokasi Brand ({allocations.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Alokasi per Brand —{" "}
            {budget.promotion_categories
              ? `[${budget.promotion_categories.account_code}] ${budget.promotion_categories.name}`
              : "—"}{" "}
            {budget.fiscal_year} Q{budget.quarter}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              Total dialokasikan:{" "}
              <span className="text-slate-200 font-medium">
                {formatIDR(totalAllocated)}
              </span>{" "}
              / {formatIDR(budget.total_amount)}
            </span>
            <AllocationDialog
              allocation={null}
              masterBudgetId={budget.id}
              fiscalYear={budget.fiscal_year}
              brands={activeBrands}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Tambah Alokasi
                </Button>
              }
            />
          </div>

          <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Nominal Alokasi</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.length > 0 ? (
                  allocations.map((alloc) => (
                    <TableRow key={alloc.id}>
                      <TableCell className="font-medium">
                        {alloc.brands?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatIDR(alloc.allocated_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <AllocationDialog
                            allocation={alloc}
                            masterBudgetId={budget.id}
                            fiscalYear={budget.fiscal_year}
                            brands={brands}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Pencil className="h-3 w-3" />
                              </Button>
                            }
                          />
                          <DeleteAllocationButton id={alloc.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-slate-500"
                    >
                      Belum ada alokasi per brand. Tambah alokasi pertama.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main Table ----

export function BudgetsTable({
  budgets,
  allocations,
  categories,
  brands,
}: {
  budgets: BudgetWithCategory[];
  allocations: AllocationWithRefs[];
  categories: PromotionCategoryRow[];
  brands: BrandRow[];
}) {
  const QUARTER_LABELS: Record<number, string> = {
    1: "Q1 (Apr–Jun)",
    2: "Q2 (Jul–Sep)",
    3: "Q3 (Okt–Des)",
    4: "Q4 (Jan–Mar)",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{budgets.length} master budget terdaftar</p>
        <MasterBudgetDialog
          budget={null}
          categories={categories}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Tambah Budget
            </Button>
          }
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Kategori Promosi</TableHead>
              <TableHead>Kode Akun</TableHead>
              <TableHead>Tahun Fiskal</TableHead>
              <TableHead>Quarter</TableHead>
              <TableHead className="text-right">Total Budget</TableHead>
              <TableHead className="text-right">Alokasi Brand</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {budgets.length > 0 ? (
              budgets.map((budget) => {
                const budgetAllocations = allocations.filter(
                  (a) => a.master_budget_id === budget.id
                );
                const totalAllocated = budgetAllocations.reduce(
                  (sum, a) => sum + a.allocated_amount,
                  0
                );

                return (
                  <TableRow key={budget.id}>
                    <TableCell className="font-medium">
                      {budget.promotion_categories?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                        {budget.promotion_categories?.account_code ?? "—"}
                      </code>
                    </TableCell>
                    <TableCell>{budget.fiscal_year}</TableCell>
                    <TableCell>
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                        {QUARTER_LABELS[budget.quarter] ?? `Q${budget.quarter}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatIDR(budget.total_amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm">
                        {formatIDR(totalAllocated)}
                      </span>
                      <span className="text-slate-500 text-xs ml-2">
                        ({budgetAllocations.length} brand)
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <AllocationsDialog
                          budget={budget}
                          allocations={budgetAllocations}
                          brands={brands}
                        />
                        <MasterBudgetDialog
                          budget={budget}
                          categories={categories}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3 w-3" />
                            </Button>
                          }
                        />
                        <DeleteBudgetButton id={budget.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-12 text-slate-500"
                >
                  Belum ada master budget. Tambah budget pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

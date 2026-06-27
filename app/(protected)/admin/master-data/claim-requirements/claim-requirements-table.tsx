"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveClaimDocumentTypeAction,
  deleteClaimDocumentTypeAction,
  saveClaimRequirementsAction,
} from "@/app/actions/master-data";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ClaimDocumentTypeRow, ClaimRequirementRow, PromotionCategoryRow } from "@/types/database";

// ─── Document Type Dialog ───────────────────────────────────────────────────

function DocumentTypeDialog({
  docType,
  nextSortOrder,
  trigger,
}: {
  docType: ClaimDocumentTypeRow | null;
  nextSortOrder: number;
  trigger: React.ReactNode;
}) {
  const isEdit = docType !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveClaimDocumentTypeAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Dokumen diperbarui" : "Dokumen ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Tipe Dokumen" : "Tambah Tipe Dokumen"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {docType && <input type="hidden" name="id" value={docType.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dt-name">Nama Dokumen</Label>
            <Input
              id="dt-name"
              name="name"
              defaultValue={docType?.name ?? ""}
              placeholder="Contoh: Invoice"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dt-sort">Urutan</Label>
            <Input
              id="dt-sort"
              name="sort_order"
              type="number"
              min={1}
              defaultValue={docType?.sort_order ?? nextSortOrder}
              required
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

// ─── Delete Document Type Button ─────────────────────────────────────────────

function DeleteDocumentTypeButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteClaimDocumentTypeAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Dokumen dihapus");
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
          className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50"
        >
          <Trash2 className="h-3 w-3" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Tipe Dokumen</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus{" "}
          <span className="font-medium text-slate-200">{name}</span>? Tidak dapat dihapus jika
          masih digunakan oleh syarat klaim atau checklist aktif.
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

// ─── Category Requirements Dialog ────────────────────────────────────────────

function CategoryRequirementsDialog({
  category,
  documentTypes,
  currentRequirements,
  trigger,
}: {
  category: PromotionCategoryRow;
  documentTypes: ClaimDocumentTypeRow[];
  currentRequirements: ClaimRequirementRow[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initialChecked = new Set(
    currentRequirements
      .filter((r) => r.promotion_category_id === category.id)
      .map((r) => r.document_type_id)
  );
  const [checked, setChecked] = useState<Set<string>>(initialChecked);

  function toggleDoc(docTypeId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(docTypeId)) next.delete(docTypeId);
      else next.add(docTypeId);
      return next;
    });
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveClaimRequirementsAction(category.id, [...checked]);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`Syarat klaim untuk "${category.name}" disimpan`);
        setOpen(false);
      }
    });
  }

  function handleOpenChange(val: boolean) {
    if (val) {
      setChecked(
        new Set(
          currentRequirements
            .filter((r) => r.promotion_category_id === category.id)
            .map((r) => r.document_type_id)
        )
      );
    }
    setOpen(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Syarat Klaim — {category.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-400 -mt-2">
          Pilih dokumen yang wajib dipenuhi distributor untuk kategori promosi ini.
        </p>

        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {documentTypes.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              Belum ada tipe dokumen. Tambah dokumen di bagian atas terlebih dahulu.
            </p>
          ) : (
            documentTypes.map((dt) => (
              <label
                key={dt.id}
                className="flex items-center gap-3 rounded-lg border border-white/8 px-4 py-3 cursor-pointer hover:bg-white/4 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked.has(dt.id)}
                  onChange={() => toggleDoc(dt.id)}
                  disabled={isPending}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 accent-emerald-500"
                />
                <span className="text-sm text-slate-200">{dt.name}</span>
              </label>
            ))
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={isPending || documentTypes.length === 0}>
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
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClaimRequirementsTable({
  documentTypes,
  categories,
  requirements,
}: {
  documentTypes: ClaimDocumentTypeRow[];
  categories: PromotionCategoryRow[];
  requirements: ClaimRequirementRow[];
}) {
  const nextSortOrder = documentTypes.length > 0
    ? Math.max(...documentTypes.map((d) => d.sort_order)) + 1
    : 1;

  return (
    <div className="space-y-10">
      {/* ── Sub-bagian 1: Tipe Dokumen ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Tipe Dokumen Klaim</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Daftar master tipe dokumen yang dapat dijadikan syarat klaim.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">{documentTypes.length} tipe dokumen terdaftar</p>
          <DocumentTypeDialog
            docType={null}
            nextSortOrder={nextSortOrder}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Dokumen
              </Button>
            }
          />
        </div>

        <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="w-16">Urutan</TableHead>
                <TableHead>Nama Dokumen</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documentTypes.length > 0 ? (
                documentTypes.map((dt) => (
                  <TableRow key={dt.id}>
                    <TableCell className="text-slate-400 text-sm">{dt.sort_order}</TableCell>
                    <TableCell className="font-medium">{dt.name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <DocumentTypeDialog
                          docType={dt}
                          nextSortOrder={nextSortOrder}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3 w-3" />
                              Edit
                            </Button>
                          }
                        />
                        <DeleteDocumentTypeButton id={dt.id} name={dt.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-12 text-slate-500">
                    Belum ada tipe dokumen. Tambah dokumen pertama Anda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Sub-bagian 2: Mapping per Kategori Promosi ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Mapping per Kategori Promosi</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Tentukan dokumen mana yang wajib dipenuhi untuk setiap kategori promosi.
          </p>
        </div>

        <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead>Kategori Promosi</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Jumlah Syarat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length > 0 ? (
                categories.map((cat) => {
                  const count = requirements.filter(
                    (r) => r.promotion_category_id === cat.id
                  ).length;
                  return (
                    <TableRow key={cat.id}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell>
                        <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                          {cat.type}
                        </code>
                      </TableCell>
                      <TableCell>
                        {count > 0 ? (
                          <span className="text-sm text-emerald-400">{count} dokumen</span>
                        ) : (
                          <span className="text-sm text-slate-500">Belum dikonfigurasi</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <CategoryRequirementsDialog
                          category={cat}
                          documentTypes={documentTypes}
                          currentRequirements={requirements}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Settings className="h-3 w-3" />
                              Set Syarat
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                    Belum ada kategori promosi.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

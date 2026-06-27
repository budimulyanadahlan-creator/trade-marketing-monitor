"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveApprovalLevelAction,
  deleteApprovalLevelAction,
  saveApproverAssignmentAction,
  deleteApproverAssignmentAction,
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
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalLevelRow, ApproverAssignmentRow, UserRow } from "@/types/database";

type AssignmentWithDetails = ApproverAssignmentRow & {
  approval_levels: { name: string; sequence: number } | null;
  users: { full_name: string } | null;
};

// -------------------------------------------------------
// Level Dialog (create / edit)
// -------------------------------------------------------

function LevelDialog({
  level,
  trigger,
}: {
  level: ApprovalLevelRow | null;
  trigger: React.ReactNode;
}) {
  const isEdit = level !== null;
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveApprovalLevelAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success(isEdit ? "Level diperbarui" : "Level ditambahkan");
      setOpen(false);
    }
  }, [state.success, isEdit]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Level Approval" : "Tambah Level Approval"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {level && <input type="hidden" name="id" value={level.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="level-name">Nama Level</Label>
            <Input
              id="level-name"
              name="name"
              defaultValue={level?.name ?? ""}
              placeholder="Contoh: NSM"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="level-seq">Urutan Approval</Label>
            <Input
              id="level-seq"
              name="sequence"
              type="number"
              min="1"
              step="1"
              defaultValue={level?.sequence ?? ""}
              placeholder="Contoh: 1"
              required
              disabled={isPending}
            />
            <p className="text-xs text-slate-500">Urutan lebih kecil = disetujui lebih dulu</p>
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

// -------------------------------------------------------
// Delete Level Button
// -------------------------------------------------------

function DeleteLevelButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteApprovalLevelAction(id);
      if (result.error) {
        toast.error(result.error);
        setOpen(false);
      } else {
        toast.success("Level dihapus");
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
          <DialogTitle>Hapus Level Approval</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus level{" "}
          <span className="font-medium text-slate-200">{name}</span>? Semua penugasan approver
          pada level ini akan ikut terhapus.
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

// -------------------------------------------------------
// Assignment Dialog (create only)
// -------------------------------------------------------

function AssignmentDialog({
  levels,
  users,
  trigger,
}: {
  levels: ApprovalLevelRow[];
  users: Pick<UserRow, "id" | "full_name" | "role">[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveApproverAssignmentAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success("Approver ditugaskan");
      setOpen(false);
    }
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tugaskan Approver</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="assign-level">Level Approval</Label>
            <Select id="assign-level" name="level_id" required disabled={isPending}>
              <option value="">— Pilih Level —</option>
              {levels
                .sort((a, b) => a.sequence - b.sequence)
                .map((lvl) => (
                  <option key={lvl.id} value={lvl.id}>
                    {lvl.sequence}. {lvl.name}
                  </option>
                ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assign-user">Approver</Label>
            <Select id="assign-user" name="user_id" required disabled={isPending}>
              <option value="">— Pilih User —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role})
                </option>
              ))}
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menugaskan...
                </>
              ) : (
                "Tugaskan"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------
// Delete Assignment Button
// -------------------------------------------------------

function DeleteAssignmentButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteApproverAssignmentAction(id);
      if (result.error) {
        toast.error(result.error);
        setOpen(false);
      } else {
        toast.success("Penugasan dihapus");
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
          <DialogTitle>Hapus Penugasan</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus penugasan approver{" "}
          <span className="font-medium text-slate-200">{name}</span>?
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

// -------------------------------------------------------
// Main component
// -------------------------------------------------------

export function ApproversTable({
  levels,
  assignments,
  users,
}: {
  levels: ApprovalLevelRow[];
  assignments: AssignmentWithDetails[];
  users: Pick<UserRow, "id" | "full_name" | "role">[];
}) {
  const sortedLevels = [...levels].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-8">
      {/* ---- Section 1: Approval Levels ---- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Level Approval</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Urutan level menentukan alur persetujuan campaign dari urutan terkecil ke terbesar.
            </p>
          </div>
          <LevelDialog
            level={null}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Level
              </Button>
            }
          />
        </div>

        <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="w-20">Urutan</TableHead>
                <TableHead>Nama Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedLevels.length > 0 ? (
                sortedLevels.map((lvl) => (
                  <TableRow key={lvl.id}>
                    <TableCell>
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400">
                        {lvl.sequence}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{lvl.name}</TableCell>
                    <TableCell>
                      <Badge variant={lvl.is_active ? "default" : "outline"}>
                        {lvl.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <LevelDialog
                          level={lvl}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3 w-3" />
                              Edit
                            </Button>
                          }
                        />
                        <DeleteLevelButton id={lvl.id} name={lvl.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                    Belum ada level approval. Tambah level pertama Anda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ---- Section 2: Approver Assignments ---- */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Penugasan Approver</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Satu level dapat memiliki lebih dari satu approver. Semua approver aktif pada level yang sama
              dapat menyetujui campaign.
            </p>
          </div>
          <AssignmentDialog
            levels={levels}
            users={users}
            trigger={
              <Button size="sm">
                <UserCheck className="h-4 w-4" />
                Tugaskan Approver
              </Button>
            }
          />
        </div>

        <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead>Level</TableHead>
                <TableHead>Approver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.length > 0 ? (
                [...assignments]
                  .sort(
                    (a, b) =>
                      (a.approval_levels?.sequence ?? 99) - (b.approval_levels?.sequence ?? 99)
                  )
                  .map((asgn) => (
                    <TableRow key={asgn.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400">
                            {asgn.approval_levels?.sequence ?? "—"}
                          </span>
                          <span className="font-medium">{asgn.approval_levels?.name ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {asgn.users?.full_name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={asgn.is_active ? "default" : "outline"}>
                          {asgn.is_active ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteAssignmentButton
                          id={asgn.id}
                          name={asgn.users?.full_name ?? "approver ini"}
                        />
                      </TableCell>
                    </TableRow>
                  ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-slate-500">
                    Belum ada approver yang ditugaskan. Tugaskan approver pertama Anda.
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

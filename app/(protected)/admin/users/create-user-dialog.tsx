"use client";

import { useActionState, useEffect, useState } from "react";
import { createUserAction } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Department, UserRole, RegionRow } from "@/types/database";

const roleRank: Record<UserRole, number> = {
  distributor: 0,
  user: 0,
  manager: 1,
  finance: 2,
  admin: 3,
  superadmin: 4,
};

const allRoles: { value: UserRole; label: string }[] = [
  { value: "distributor", label: "Distributor" },
  { value: "user", label: "User" },
  { value: "manager", label: "Manager" },
  { value: "finance", label: "Finance" },
  { value: "admin", label: "Admin" },
  { value: "superadmin", label: "Superadmin" },
];

interface CreateUserDialogProps {
  departments: Department[];
  regions: RegionRow[];
  actorRole: UserRole;
}

export function CreateUserDialog({ departments, regions, actorRole }: CreateUserDialogProps) {
  const assignableRoles = allRoles.filter(
    (r) => roleRank[r.value] < roleRank[actorRole]
  );
  const [open, setOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(
    assignableRoles[0]?.value ?? "user"
  );
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [state, formAction, isPending] = useActionState(createUserAction, {});

  const isDistributor = selectedRole === "distributor";
  const selectedDept = departments.find((d) => d.id === selectedDepartmentId);
  const isSalesDept = selectedDept?.name?.toLowerCase() === "sales";
  const needsRegion = isDistributor || isSalesDept;

  const DISTRIBUTOR_DEPT_NAMES = ["Sales", "Finance", "Operational"];
  const distributorDepts = departments.filter((d) =>
    DISTRIBUTOR_DEPT_NAMES.some((n) => d.name.toLowerCase() === n.toLowerCase())
  );

  useEffect(() => {
    if (state.success) {
      toast.success("User berhasil dibuat");
      setOpen(false);
    }
  }, [state.success]);

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) {
      setSelectedRole(assignableRoles[0]?.value ?? "user");
      setSelectedDepartmentId("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="h-4 w-4" />
          Tambah User
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah User Baru</DialogTitle>
          <DialogDescription>
            Buat akun dan tetapkan role untuk anggota tim baru.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="full_name">Nama Lengkap</Label>
            <Input
              id="full_name"
              name="full_name"
              placeholder="Budi Santoso"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="budi@perusahaan.com"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password Awal</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Min. 8 karakter"
              required
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="role">Role</Label>
              <Select
                id="role"
                name="role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                required
                disabled={isPending}
              >
                {assignableRoles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="region_id">
                Region {needsRegion && <span className="text-rose-400">*</span>}
              </Label>
              <Select
                id="region_id"
                name="region_id"
                required={needsRegion}
                disabled={isPending}
              >
                <option value="">— Pilih Region —</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {needsRegion ? (
            <div className="space-y-1.5">
              <Label htmlFor="department_id">
                Departemen <span className="text-rose-400">*</span>
              </Label>
              <Select
                id="department_id"
                name="department_id"
                required
                disabled={isPending}
              >
                <option value="">— Pilih Departemen —</option>
                {distributorDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="department_id">Departemen</Label>
              <Select
                id="department_id"
                name="department_id"
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                disabled={isPending}
              >
                <option value="">— Pilih Departemen —</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
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

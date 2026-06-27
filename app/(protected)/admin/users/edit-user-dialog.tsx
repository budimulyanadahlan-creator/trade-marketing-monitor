"use client";

import { useActionState, useEffect, useState } from "react";
import { updateUserAction } from "@/app/actions/admin-users";
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
import { AlertCircle, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import type { UserRole, RegionRow, Department } from "@/types/database";

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

interface Props {
  user: {
    id: string;
    full_name: string;
    role: UserRole;
    department_id: string | null;
    region_id: string | null;
  };
  departments: Department[];
  regions: RegionRow[];
  actorRole: UserRole;
}

export function EditUserDialog({ user, departments, regions, actorRole }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(user.department_id ?? "");
  const [state, formAction, isPending] = useActionState(updateUserAction, {});

  const assignableRoles = allRoles.filter((r) => roleRank[r.value] < roleRank[actorRole]);

  const DISTRIBUTOR_DEPT_NAMES = ["Sales", "Finance", "Operational"];
  const distributorDepts = departments.filter((d) =>
    DISTRIBUTOR_DEPT_NAMES.some((n) => d.name.toLowerCase() === n.toLowerCase())
  );

  const isDistributor = selectedRole === "distributor";
  const selectedDept = departments.find((d) => d.id === selectedDepartmentId);
  const isSalesDept = selectedDept?.name?.toLowerCase() === "sales";
  const needsRegion = isDistributor || isSalesDept;

  useEffect(() => {
    if (state.success) {
      toast.success("User berhasil diperbarui");
      setOpen(false);
    }
  }, [state.success]);

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) {
      setSelectedRole(user.role);
      setSelectedDepartmentId(user.department_id ?? "");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={user.id} />

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="eu-name">Nama Lengkap</Label>
            <Input
              id="eu-name"
              name="full_name"
              defaultValue={user.full_name}
              required
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="eu-role">Role</Label>
              <Select
                id="eu-role"
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
              <Label htmlFor="eu-region">
                Region {needsRegion && <span className="text-rose-400">*</span>}
              </Label>
              <Select
                id="eu-region"
                name="region_id"
                defaultValue={user.region_id ?? ""}
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

          {selectedRole === "distributor" ? (
            <div className="space-y-1.5">
              <Label htmlFor="eu-dept">
                Departemen <span className="text-rose-400">*</span>
              </Label>
              <Select
                id="eu-dept"
                name="department_id"
                defaultValue={user.department_id ?? ""}
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
              <Label htmlFor="eu-dept">Departemen</Label>
              <Select
                id="eu-dept"
                name="department_id"
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                disabled={isPending}
              >
                <option value="">— Pilih Departemen —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan...</> : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

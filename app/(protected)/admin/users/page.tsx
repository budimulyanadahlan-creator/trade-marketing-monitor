import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreateUserDialog } from "./create-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { DeleteUserButton } from "./delete-user-button";
import { ToggleActiveButton } from "./toggle-active-button";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { formatDate } from "@/lib/utils";
import type { UserRole, UserRow, DepartmentRow, RegionRow } from "@/types/database";

type UserWithDepartment = UserRow & {
  departments: Pick<DepartmentRow, "name"> | null;
  regions: Pick<RegionRow, "name"> | null;
};

const roleRank: Record<UserRole, number> = {
  distributor: 0,
  user: 0,
  manager: 1,
  finance: 2,
  admin: 3,
  superadmin: 4,
};

const roleBadgeVariant: Record<
  UserRole,
  "default" | "secondary" | "destructive" | "warning" | "outline"
> = {
  superadmin: "destructive",
  admin: "warning",
  finance: "default",
  manager: "secondary",
  user: "outline",
  distributor: "outline",
};

const roleLabel: Record<UserRole, string> = {
  superadmin: "Superadmin",
  admin: "Admin",
  finance: "Finance",
  manager: "Manager",
  user: "User",
  distributor: "Distributor",
};

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: currentProfile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (
    !currentProfile ||
    !["admin", "superadmin"].includes(currentProfile.role)
  ) {
    redirect("/dashboard");
  }

  const actorRole = currentProfile.role as UserRole;

  const { data: rawUsers } = await supabase
    .from("users")
    .select("*, departments(name), regions(name)")
    .order("created_at", { ascending: false });

  const users = rawUsers as UserWithDepartment[] | null;

  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .order("name");

  const { data: regions } = await supabase
    .from("regions")
    .select("*")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Kelola User</h1>
          <p className="text-slate-400 text-sm mt-1">
            {users?.length ?? 0} user terdaftar
          </p>
        </div>
        <CreateUserDialog departments={departments ?? []} regions={regions ?? []} actorRole={actorRole} />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Nama</TableHead>
              <TableHead>Departemen</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users && users.length > 0 ? (
              users.map((u) => {
                const isSelf = u.id === user.id;
                const targetRank = roleRank[u.role];
                const actorRank = roleRank[actorRole];
                const canManage = !isSelf && actorRank > targetRank;

                const disabledReason = isSelf
                  ? "Tidak bisa menonaktifkan akun sendiri"
                  : !canManage
                  ? `Role ${roleLabel[actorRole]} tidak bisa mengelola ${roleLabel[u.role]}`
                  : undefined;

                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-slate-400">
                      {u.departments?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-slate-400">
                      {u.regions?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant[u.role]}>
                        {roleLabel[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? "default" : "outline"}>
                        {u.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {formatDate(u.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canManage && (
                          <EditUserDialog
                            user={{
                              id: u.id,
                              full_name: u.full_name,
                              role: u.role,
                              department_id: u.department_id ?? null,
                              region_id: u.region_id ?? null,
                            }}
                            departments={departments ?? []}
                            regions={regions ?? []}
                            actorRole={actorRole}
                          />
                        )}
                        <ToggleActiveButton
                          userId={u.id}
                          isActive={u.is_active}
                          disabled={!canManage}
                          disabledReason={disabledReason}
                        />
                        <ResetPasswordDialog
                          userId={u.id}
                          userName={u.full_name}
                          disabled={!canManage}
                          disabledReason={disabledReason}
                        />
                        <DeleteUserButton
                          userId={u.id}
                          userName={u.full_name}
                          disabled={!canManage}
                          disabledReason={disabledReason}
                        />
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
                  Belum ada user. Tambah user pertama Anda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

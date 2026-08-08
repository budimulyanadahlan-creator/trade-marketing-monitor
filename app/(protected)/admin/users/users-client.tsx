"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { CreateUserDialog } from "./create-user-dialog";
import { EditUserDialog } from "./edit-user-dialog";
import { DeleteUserButton } from "./delete-user-button";
import { ToggleActiveButton } from "./toggle-active-button";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { formatDate } from "@/lib/utils";
import { filterBySearch } from "@/lib/search";
import type {
  UserRole,
  UserRow,
  Department,
  DepartmentRow,
  RegionRow,
  DistributorRow,
} from "@/types/database";

type UserWithDepartment = UserRow & {
  departments: Pick<DepartmentRow, "name"> | null;
  regions: Pick<RegionRow, "name"> | null;
  distributors: Pick<DistributorRow, "name"> | null;
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

interface UsersClientProps {
  users: UserWithDepartment[];
  currentUserId: string;
  actorRole: UserRole;
  departments: Department[];
  regions: RegionRow[];
  distributors: Pick<DistributorRow, "id" | "name">[];
}

export function UsersClient({
  users,
  currentUserId,
  actorRole,
  departments,
  regions,
  distributors,
}: UsersClientProps) {
  const [query, setQuery] = useState("");

  const filteredUsers = useMemo(
    () =>
      filterBySearch(users, query, (u) => [
        u.full_name,
        u.departments?.name,
        u.regions?.name,
      ]),
    [users, query]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Kelola User</h1>
          <p className="text-slate-400 text-sm mt-1">
            {filteredUsers.length} user terdaftar
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari nama, departemen, atau region..."
            className="w-72"
          />
          <CreateUserDialog
            departments={departments}
            regions={regions}
            distributors={distributors}
            actorRole={actorRole}
          />
        </div>
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
            {filteredUsers.length > 0 ? (
              filteredUsers.map((u) => {
                const isSelf = u.id === currentUserId;
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
                              distributor_id: u.distributor_id ?? null,
                            }}
                            departments={departments}
                            regions={regions}
                            distributors={distributors}
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
                  {query.trim() ? (
                    <>Tidak ada hasil untuk &ldquo;{query.trim()}&rdquo;</>
                  ) : (
                    "Belum ada user. Tambah user pertama Anda."
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

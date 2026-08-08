import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UsersClient } from "./users-client";
import type { UserRole, UserRow, DepartmentRow, RegionRow, DistributorRow } from "@/types/database";

type UserWithDepartment = UserRow & {
  departments: Pick<DepartmentRow, "name"> | null;
  regions: Pick<RegionRow, "name"> | null;
  distributors: Pick<DistributorRow, "name"> | null;
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
    .select("*, departments(name), regions(name), distributors(name)")
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

  const { data: distributors } = await supabase
    .from("distributors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <UsersClient
      users={users ?? []}
      currentUserId={user.id}
      actorRole={actorRole}
      departments={departments ?? []}
      regions={regions ?? []}
      distributors={distributors ?? []}
    />
  );
}

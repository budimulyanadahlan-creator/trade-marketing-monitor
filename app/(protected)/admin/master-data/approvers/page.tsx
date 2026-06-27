import { createClient } from "@/lib/supabase/server";
import { ApproversTable } from "./approvers-table";
import type { ApprovalLevelRow, ApproverAssignmentRow, UserRow } from "@/types/database";

type AssignmentWithDetails = ApproverAssignmentRow & {
  approval_levels: { name: string; sequence: number } | null;
  users: { full_name: string } | null;
};

export default async function ApproversPage() {
  const supabase = await createClient();

  const [{ data: levels }, { data: rawAssignments }, { data: rawUsers }] = await Promise.all([
    supabase
      .from("approval_levels")
      .select("*")
      .order("sequence"),
    supabase
      .from("approver_assignments")
      .select("*, approval_levels(name, sequence), users(full_name)")
      .order("created_at"),
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("is_active", true)
      .in("role", ["manager", "finance", "admin", "superadmin"])
      .order("full_name"),
  ]);

  const users = rawUsers as Pick<UserRow, "id" | "full_name" | "role">[] | null;

  return (
    <ApproversTable
      levels={(levels as ApprovalLevelRow[]) ?? []}
      assignments={(rawAssignments as AssignmentWithDetails[]) ?? []}
      users={users ?? []}
    />
  );
}

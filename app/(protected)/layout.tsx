import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import type { UserRole, CampaignStatus } from "@/types/database";

const SEQ_TO_STATUS: Record<number, string> = {
  1: "submitted",
  2: "approved_l1",
  3: "approved_l2",
  4: "approved_l3",
  5: "approved_l4",
};

/**
 * Returns the campaign statuses this user is responsible for approving.
 * Used for both the bell badge count and realtime toast notifications.
 */
async function getPendingStatuses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  role: string
): Promise<string[]> {
  if (role === "admin" || role === "superadmin") {
    const { data: levels } = await supabase
      .from("approval_levels")
      .select("sequence")
      .eq("is_active", true);

    return (levels ?? [])
      .map((l) => SEQ_TO_STATUS[l.sequence])
      .filter(Boolean);
  }

  const { data: assignments } = await supabase
    .from("approver_assignments")
    .select("approval_levels(sequence)")
    .eq("user_id", userId)
    .eq("is_active", true);

  return (assignments ?? [])
    .flatMap((a) => {
      const level = a.approval_levels as { sequence: number } | null;
      return level ? [SEQ_TO_STATUS[level.sequence]].filter(Boolean) : [];
    });
}

async function getNotificationCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pendingStatuses: string[]
): Promise<number> {
  if (pendingStatuses.length === 0) return 0;

  const { count } = await supabase
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .in("status", pendingStatuses as CampaignStatus[]);

  return count ?? 0;
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, is_active, department_id")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  const pendingStatuses = await getPendingStatuses(supabase, user.id, profile.role);
  const notificationCount = await getNotificationCount(supabase, pendingStatuses);

  return (
    <AppShell
      fullName={profile.full_name}
      role={profile.role as UserRole}
      notificationCount={notificationCount}
      userId={user.id}
      departmentId={profile.department_id}
      pendingStatuses={pendingStatuses}
    >
      {children}
    </AppShell>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { logoutAction } from "@/app/actions/auth";
import { RealtimeNotifications } from "@/components/realtime-notifications";
import type { UserRole } from "@/types/database";
import { Toaster } from "sonner";

interface AppShellProps {
  fullName: string;
  role: UserRole;
  notificationCount: number;
  userId: string;
  departmentId: string | null;
  pendingStatuses: string[];
  children: React.ReactNode;
}

export function AppShell({
  fullName,
  role,
  notificationCount,
  userId,
  departmentId,
  pendingStatuses,
  children,
}: AppShellProps) {
  const router = useRouter();

  async function handleLogout() {
    await logoutAction();
    router.push("/login");
  }

  return (
    <div className="dark flex h-screen overflow-hidden bg-slate-950">
      <Sidebar userRole={role} onLogout={handleLogout} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          fullName={fullName}
          role={role}
          notificationCount={notificationCount}
          onLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      <Toaster richColors position="top-right" />
      <RealtimeNotifications
        userId={userId}
        role={role}
        departmentId={departmentId}
        pendingStatuses={pendingStatuses}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  FileText,
  CheckSquare,
  Users,
  Database,
  LogOut,
  TableProperties,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/database";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    roles: ["user", "manager", "finance", "admin", "superadmin"],
  },
  {
    href: "/campaigns",
    label: "SKP",
    icon: <FileText className="h-4 w-4" />,
    roles: ["user", "manager", "finance", "admin", "superadmin", "distributor"],
  },
  {
    href: "/approvals",
    label: "Persetujuan",
    icon: <CheckSquare className="h-4 w-4" />,
    roles: ["admin", "superadmin"],
  },
  {
    href: "/rekap",
    label: "Rekap",
    icon: <TableProperties className="h-4 w-4" />,
    roles: ["admin", "finance", "superadmin", "distributor"],
  },
  {
    href: "/admin/users",
    label: "Kelola User",
    icon: <Users className="h-4 w-4" />,
    roles: ["admin", "superadmin"],
  },
  {
    href: "/admin/master-data",
    label: "Master Data",
    icon: <Database className="h-4 w-4" />,
    roles: ["admin", "superadmin"],
  },
];

interface SidebarProps {
  userRole: UserRole;
  onLogout: () => void;
}

export function Sidebar({ userRole, onLogout }: SidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  );

  return (
    <aside className="flex h-full w-60 flex-col bg-[#0a1020] border-r border-white/6">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/25">
          <BarChart3 className="h-4 w-4 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 leading-tight truncate">
            TM Monitor
          </p>
          <p className="text-xs text-slate-500 truncate">Budget Management</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                  : "text-slate-400 hover:text-slate-100 hover:bg-white/6"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-white/6 p-2">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/8 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Keluar
        </button>
      </div>
    </aside>
  );
}

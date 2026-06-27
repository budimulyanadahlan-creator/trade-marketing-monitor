"use client";

import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/types/database";

const roleLabel: Record<UserRole, string> = {
  distributor: "Distributor",
  user: "User",
  manager: "Manager",
  finance: "Finance",
  admin: "Admin",
  superadmin: "Superadmin",
};

interface HeaderProps {
  fullName: string;
  role: UserRole;
  notificationCount: number;
  onLogout: () => void;
}

export function Header({ fullName, role, notificationCount, onLogout }: HeaderProps) {
  const initials = fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/6 bg-[#0a1020]/80 backdrop-blur-md px-4 shrink-0">
      {/* Page title placeholder — will be replaced per-page via <title> */}
      <div />

      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <Button variant="ghost" size="icon" className="relative text-slate-400">
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white leading-none">
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/6 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold">
                {initials}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-medium text-slate-200 leading-tight">
                  {fullName}
                </p>
                <p className="text-xs text-slate-500">{roleLabel[role]}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium text-slate-100">{fullName}</p>
              <Badge variant="secondary" className="mt-1 text-xs">
                {roleLabel[role]}
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onLogout}
              className="text-rose-400 focus:text-rose-400 focus:bg-rose-500/10"
            >
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

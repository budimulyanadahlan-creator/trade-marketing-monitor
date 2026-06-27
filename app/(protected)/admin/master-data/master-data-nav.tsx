"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/admin/master-data/departments", label: "Departemen" },
  { href: "/admin/master-data/brands", label: "Brand" },
  { href: "/admin/master-data/regions", label: "Region" },
  { href: "/admin/master-data/channels", label: "Channel" },
  { href: "/admin/master-data/categories", label: "Kategori Promosi" },
  { href: "/admin/master-data/vendors", label: "Vendor" },
  { href: "/admin/master-data/budgets", label: "Master Budget" },
  { href: "/admin/master-data/action-approvals", label: "Action Approval" },
  { href: "/admin/master-data/approvers", label: "Approver" },
  { href: "/admin/master-data/claim-requirements", label: "Syarat Klaim" },
];

export function MasterDataNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-white/8 pb-0">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              isActive
                ? "border-emerald-500 text-emerald-400"
                : "border-transparent text-slate-400 hover:text-slate-100 hover:border-white/20"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

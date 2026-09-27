import Link from "next/link";
import { History } from "lucide-react";
import { auditFiltersQuery } from "@/lib/posm";

/** Tautan ke riwayat perubahan record (admin/superadmin saja). */
export function AuditHistoryLink({ recordId }: { recordId: string }) {
  return (
    <Link
      href={`/monitoring-posm/audit?${auditFiltersQuery({ record: recordId })}`}
      className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-300"
    >
      <History className="h-3.5 w-3.5" />
      Riwayat perubahan
    </Link>
  );
}

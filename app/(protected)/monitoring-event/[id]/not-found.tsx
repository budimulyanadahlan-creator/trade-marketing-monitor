import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function EventNotFound() {
  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-event"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring Event
      </Link>
      <div className="rounded-xl border border-white/8 bg-white/2 py-12 text-center">
        <p className="font-medium text-slate-200">Event tidak ditemukan</p>
        <p className="mt-1 text-sm text-slate-500">Event mungkin sudah dihapus atau tautannya tidak valid.</p>
      </div>
    </div>
  );
}

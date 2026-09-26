import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { balanceOf, stockStatus, withRunningBalance } from "@/lib/posm";
import { StockStatusBadge } from "../../stock-status-badge";
import { requirePosmViewer } from "../../viewer";
import { PosmMovementsPanel, type PosmMovementListRow } from "./posm-movements-panel";

export default async function PosmItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canManage } = await requirePosmViewer();

  const [{ data: item }, { data: movements }, { data: regions }] = await Promise.all([
    supabase
      .from("posm_items")
      .select("id, code, name, category, unit, min_stock, is_active, brand:brands(name)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("posm_movements")
      .select(
        "id, movement_date, type, quantity, region_id, notes, created_at, region:regions(name), creator:created_by(full_name)"
      )
      .eq("item_id", id)
      .is("deleted_at", null),
    supabase.from("regions").select("id, name, is_active").order("name"),
  ]);

  if (!item) notFound();

  const rows: PosmMovementListRow[] = withRunningBalance(
    (movements ?? []).map(({ region, creator, ...m }) => ({
      ...m,
      region_name: (region as { name: string } | null)?.name ?? null,
      creator_name: (creator as { full_name: string } | null)?.full_name ?? null,
    }))
  ).reverse();

  const balance = balanceOf(rows);
  const brandName = (item.brand as { name: string } | null)?.name;

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-posm?tab=posm"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring POSM
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{item.code}</code>
            {!item.is_active && <Badge variant="outline">Nonaktif</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{item.name}</h1>
          <p className="text-sm text-slate-400">
            {[brandName, item.category, `satuan ${item.unit}`].filter(Boolean).join(" • ")}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Saldo</p>
          <p className="text-2xl font-bold tabular-nums text-slate-100">
            {balance.toLocaleString("id-ID")} <span className="text-sm font-normal text-slate-400">{item.unit}</span>
          </p>
          <div className="mt-1 flex items-center justify-end gap-2 text-xs text-slate-500">
            {item.min_stock !== null && <span>min. {item.min_stock.toLocaleString("id-ID")}</span>}
            <StockStatusBadge status={stockStatus(balance, item.min_stock)} />
          </div>
        </div>
      </div>

      <PosmMovementsPanel
        item={{ id: item.id, unit: item.unit, is_active: item.is_active }}
        movements={rows}
        regions={regions ?? []}
        canManage={canManage}
      />
    </div>
  );
}

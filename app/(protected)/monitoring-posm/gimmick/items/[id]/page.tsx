import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatIDR } from "@/lib/utils";
import { balanceOf, stockStatus } from "@/lib/posm";
import { formatPcsWithCartons, withRunningValue } from "@/lib/gimmick";
import { StockStatusBadge } from "../../../stock-status-badge";
import { requirePosmViewer } from "../../../viewer";
import { GimmickMovementsPanel, type GimmickMovementListRow } from "./gimmick-movements-panel";

export default async function GimmickItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canManage } = await requirePosmViewer();

  // Data gimmick hanya untuk pemegang can_manage_posm() (RLS juga menolak).
  if (!canManage) redirect("/monitoring-posm");

  const [{ data: item }, { data: movements }, { data: items }] = await Promise.all([
    supabase
      .from("gimmick_items")
      .select(
        "id, code, name, category, unit, pcs_per_carton, unit_cost, min_stock, program, is_active, brand:brands(name)"
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("gimmick_movements")
      .select(
        "id, movement_date, type, quantity, unit_cost_snapshot, notes, created_at, creator:created_by(full_name)"
      )
      .eq("item_id", id)
      .is("deleted_at", null),
    // Pilihan item saat mengganti item pada edit mutasi.
    supabase
      .from("gimmick_items")
      .select("id, code, name, unit, pcs_per_carton, is_active")
      .is("deleted_at", null)
      .order("code"),
  ]);

  if (!item) notFound();

  const rows: GimmickMovementListRow[] = withRunningValue(
    (movements ?? []).map(({ creator, ...m }) => ({
      ...m,
      unit_cost_snapshot: Number(m.unit_cost_snapshot),
      creator_name: (creator as { full_name: string } | null)?.full_name ?? null,
    }))
  ).reverse();

  const balance = balanceOf(rows);
  const unitCost = Number(item.unit_cost);
  const brandName = (item.brand as { name: string } | null)?.name;

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-posm?tab=gimmick"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring Gimmick
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{item.code}</code>
            {!item.is_active && <Badge variant="outline">Nonaktif</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-slate-100">{item.name}</h1>
          <p className="text-sm text-slate-400">
            {[
              brandName,
              item.program,
              item.category,
              item.pcs_per_carton ? `${item.pcs_per_carton} ${item.unit}/karton` : `satuan ${item.unit}`,
              `harga pokok ${formatIDR(unitCost)}/${item.unit}`,
            ]
              .filter(Boolean)
              .join(" • ")}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Saldo</p>
          <p className="text-2xl font-bold tabular-nums text-slate-100">
            {formatPcsWithCartons(balance, item.pcs_per_carton, item.unit)}
          </p>
          <p className="text-sm tabular-nums text-slate-400">Nilai stok {formatIDR(balance * unitCost)}</p>
          <div className="mt-1 flex items-center justify-end gap-2 text-xs text-slate-500">
            {item.min_stock !== null && <span>min. {item.min_stock.toLocaleString("id-ID")}</span>}
            <StockStatusBadge status={stockStatus(balance, item.min_stock)} />
          </div>
        </div>
      </div>

      <GimmickMovementsPanel
        item={{
          id: item.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          pcs_per_carton: item.pcs_per_carton,
          is_active: item.is_active,
        }}
        items={items ?? []}
        movements={rows}
      />
    </div>
  );
}

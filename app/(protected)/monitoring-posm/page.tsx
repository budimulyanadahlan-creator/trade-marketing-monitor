import Link from "next/link";
import { ArrowRightLeft, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { nextCode, POSM_CODE_PREFIX, stockStatus } from "@/lib/posm";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MonitoringPosmTabs, type MonitoringPosmTab } from "./monitoring-posm-tabs";
import { PosmItemsTable, type PosmItemListRow } from "./posm-items-table";
import { requirePosmViewer } from "./viewer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function resolveTab(v: string | string[] | undefined): MonitoringPosmTab {
  const tab = Array.isArray(v) ? v[0] : v;
  return tab === "asset" ? "asset" : "posm";
}

export default async function MonitoringPosmPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { canManage } = await requirePosmViewer();

  const tab = resolveTab((await searchParams).tab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Monitoring POSM</h1>
        <p className="text-slate-400 text-sm">
          Stok POSM dan register asset marketing
          {!canManage && <span className="text-slate-600"> • mode baca saja</span>}
        </p>
      </div>

      <MonitoringPosmTabs active={tab} />

      {tab === "posm" ? (
        <PosmTab canManage={canManage} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-white/8 bg-white/2 py-16 text-center">
          <Boxes className="h-8 w-8 text-slate-600" />
          <p className="text-sm text-slate-400">Register asset marketing segera hadir.</p>
        </div>
      )}
    </div>
  );
}

async function PosmTab({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();

  const [{ data: items }, { data: brands }, { data: balances }] = await Promise.all([
    supabase
      .from("posm_items")
      .select("id, code, name, brand_id, category, unit, min_stock, is_active, brand:brands(name)")
      .is("deleted_at", null)
      .order("code"),
    supabase.from("brands").select("id, name, is_active").order("name"),
    supabase.from("posm_stock_balances").select("item_id, balance, last_movement_date, movement_count_all"),
  ]);

  const balanceByItem = new Map((balances ?? []).map((b) => [b.item_id, b]));

  const rows: PosmItemListRow[] = (items ?? []).map(({ brand, ...item }) => {
    const b = balanceByItem.get(item.id);
    const balance = b?.balance ?? 0;
    return {
      ...item,
      brand_name: (brand as { name: string } | null)?.name ?? null,
      balance,
      stock_status: stockStatus(balance, item.min_stock),
      last_movement_date: b?.last_movement_date ?? null,
      has_movements: (b?.movement_count_all ?? 0) > 0,
    };
  });

  const active = rows.filter((r) => r.is_active);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Item Aktif" value={active.length} type="count" />
        <KpiCard label="Stok Menipis" value={active.filter((r) => r.stock_status === "menipis").length} type="count" />
        <KpiCard label="Stok Habis" value={active.filter((r) => r.stock_status === "habis").length} type="count" />
      </div>

      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/monitoring-posm/movements">
            <ArrowRightLeft className="h-4 w-4" />
            Daftar Mutasi
          </Link>
        </Button>
      </div>

      <PosmItemsTable
        items={rows}
        brands={brands ?? []}
        canManage={canManage}
        suggestedCode={nextCode(POSM_CODE_PREFIX, rows.map((r) => r.code))}
      />
    </div>
  );
}

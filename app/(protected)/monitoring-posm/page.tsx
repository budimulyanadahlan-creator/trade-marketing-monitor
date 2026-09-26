import Link from "next/link";
import { ArrowRightLeft, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import {
  ASSET_CODE_PREFIX,
  ASSET_CONDITIONS,
  nextCode,
  POSM_CODE_PREFIX,
  stockStatus,
  summarizeAssets,
} from "@/lib/posm";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AssetConditionBadge, AssetsTable, type AssetListRow } from "./assets-table";
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
        <AssetTab canManage={canManage} />
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

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/monitoring-posm/rekap">
            <Table2 className="h-4 w-4" />
            Rekap Keluar per Region
          </Link>
        </Button>
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

async function AssetTab({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();

  const [{ data: assets }, { data: statuses }, { data: brands }, { data: regions }, { data: distributors }] =
    await Promise.all([
      supabase
        .from("marketing_assets")
        .select(
          "id, code, name, asset_type, brand_id, serial_number, acquisition_date, acquisition_value, brand:brands(name)"
        )
        .is("deleted_at", null)
        .order("code"),
      supabase
        .from("asset_current_status")
        .select("asset_id, destination, region_id, distributor_id, store_name, condition, placement_count_all"),
      supabase.from("brands").select("id, name, is_active").order("name"),
      supabase.from("regions").select("id, name, is_active").order("name"),
      supabase.from("distributors").select("id, name, is_active").order("name"),
    ]);

  const statusByAsset = new Map((statuses ?? []).map((s) => [s.asset_id, s]));
  const regionName = new Map((regions ?? []).map((r) => [r.id, r.name]));
  const distributorName = new Map((distributors ?? []).map((d) => [d.id, d.name]));

  // Kondisi & lokasi dari catatan penempatan terakhir. Database menjamin
  // setiap asset punya penempatan; asset tanpa status dilewati.
  const rows: AssetListRow[] = (assets ?? []).flatMap(({ brand, ...asset }) => {
    const s = statusByAsset.get(asset.id);
    if (!s) return [];
    return [
      {
        ...asset,
        acquisition_value: Number(asset.acquisition_value),
        brand_name: (brand as { name: string } | null)?.name ?? null,
        condition: s.condition,
        destination: s.destination,
        region_id: s.region_id,
        region_name: s.region_id ? (regionName.get(s.region_id) ?? null) : null,
        distributor_name: s.distributor_id ? (distributorName.get(s.distributor_id) ?? null) : null,
        store_name: s.store_name,
        can_delete: s.placement_count_all <= 1,
      },
    ];
  });

  const summary = summarizeAssets(rows);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Unit" value={summary.totalUnits} type="count" />
        <KpiCard label="Total Nilai Perolehan" value={summary.totalValue} type="currency" />
        <KpiCard label="Di Gudang Pusat" value={summary.inWarehouse} type="count" />
        <KpiCard label="Ditempatkan" value={summary.placed} type="count" />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/2 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Kondisi</span>
        {ASSET_CONDITIONS.map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-sm">
            <AssetConditionBadge condition={c} />
            <span className="tabular-nums text-slate-200">{summary.byCondition[c].toLocaleString("id-ID")}</span>
          </span>
        ))}
      </div>

      <AssetsTable
        assets={rows}
        brands={brands ?? []}
        regions={regions ?? []}
        distributors={distributors ?? []}
        canManage={canManage}
        suggestedCode={nextCode(ASSET_CODE_PREFIX, rows.map((r) => r.code))}
      />
    </div>
  );
}

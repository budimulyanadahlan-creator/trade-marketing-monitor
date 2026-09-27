import Link from "next/link";
import { ArrowRightLeft, History, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import {
  ASSET_CODE_PREFIX,
  ASSET_CONDITIONS,
  nextCode,
  POSM_CODE_PREFIX,
  posmExportHref,
  stockStatus,
  summarizeAssets,
} from "@/lib/posm";
import { GIMMICK_CODE_PREFIX, resolveMonitoringPosmTab } from "@/lib/gimmick";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AssetConditionBadge, AssetsTable, type AssetListRow } from "./assets-table";
import { ExportExcelButton } from "./export-excel-button";
import { GimmickItemsTable, type GimmickItemListRow } from "./gimmick-items-table";
import { MonitoringPosmTabs } from "./monitoring-posm-tabs";
import { PosmItemsTable, type PosmItemListRow } from "./posm-items-table";
import { requirePosmViewer } from "./viewer";
import { photoUrlOf, signPosmPhotos } from "./photo-urls";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MonitoringPosmPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { canManage, isAdmin } = await requirePosmViewer();

  // Tab Gimmick hanya untuk pemegang can_manage_posm(); user lain ke tab POSM.
  const tab = resolveMonitoringPosmTab((await searchParams).tab, canManage);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Monitoring POSM</h1>
        <p className="text-slate-400 text-sm">
          Stok POSM dan register asset marketing
          {!canManage && <span className="text-slate-600"> • mode baca saja</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonitoringPosmTabs active={tab} canManage={canManage} />
        <div className="flex gap-2">
          <ExportExcelButton href={posmExportHref({})} />
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link href="/monitoring-posm/audit">
                <History className="h-4 w-4" />
                Audit Log
              </Link>
            </Button>
          )}
        </div>
      </div>

      {tab === "posm" && <PosmTab canManage={canManage} />}
      {tab === "asset" && <AssetTab canManage={canManage} />}
      {tab === "gimmick" && <GimmickTab />}
    </div>
  );
}

async function PosmTab({ canManage }: { canManage: boolean }) {
  const supabase = await createClient();

  const [{ data: items }, { data: brands }, { data: balances }] = await Promise.all([
    supabase
      .from("posm_items")
      .select("id, code, name, brand_id, category, unit, min_stock, is_active, photo_path, brand:brands(name)")
      .is("deleted_at", null)
      .order("code"),
    supabase.from("brands").select("id, name, is_active").order("name"),
    supabase.from("posm_stock_balances").select("item_id, balance, last_movement_date, movement_count_all"),
  ]);

  const balanceByItem = new Map((balances ?? []).map((b) => [b.item_id, b]));
  const photoUrls = await signPosmPhotos(supabase, (items ?? []).map((i) => i.photo_path));

  const rows: PosmItemListRow[] = (items ?? []).map(({ brand, photo_path, ...item }) => {
    const b = balanceByItem.get(item.id);
    const balance = b?.balance ?? 0;
    return {
      ...item,
      brand_name: (brand as { name: string } | null)?.name ?? null,
      balance,
      stock_status: stockStatus(balance, item.min_stock),
      last_movement_date: b?.last_movement_date ?? null,
      has_movements: (b?.movement_count_all ?? 0) > 0,
      photo_url: photoUrlOf(photoUrls, photo_path),
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

  const [
    { data: assets },
    { data: statuses },
    { data: brands },
    { data: regions },
    { data: distributors },
    { data: storeNames },
  ] = await Promise.all([
    supabase
      .from("marketing_assets")
      .select(
        "id, code, name, asset_type, brand_id, serial_number, acquisition_date, acquisition_value, photo_path, brand:brands(name)"
      )
      .is("deleted_at", null)
      .order("code"),
    supabase
      .from("asset_current_status")
      .select("asset_id, destination, region_id, distributor_id, store_name, condition, placement_count_all"),
    supabase.from("brands").select("id, name, is_active").order("name"),
    supabase.from("regions").select("id, name, is_active").order("name"),
    supabase.from("distributors").select("id, name, is_active").order("name"),
    supabase.from("asset_store_names").select("store_name").order("store_name"),
  ]);

  const statusByAsset = new Map((statuses ?? []).map((s) => [s.asset_id, s]));
  const regionName = new Map((regions ?? []).map((r) => [r.id, r.name]));
  const distributorName = new Map((distributors ?? []).map((d) => [d.id, d.name]));
  const photoUrls = await signPosmPhotos(supabase, (assets ?? []).map((a) => a.photo_path));

  // Kondisi & lokasi dari catatan penempatan terakhir. Database menjamin
  // setiap asset punya penempatan; asset tanpa status dilewati.
  const rows: AssetListRow[] = (assets ?? []).flatMap(({ brand, photo_path, ...asset }) => {
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
        photo_url: photoUrlOf(photoUrls, photo_path),
      },
    ];
  });

  const summary = summarizeAssets(rows);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Unit Aktif" value={summary.totalUnits} type="count" />
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
        storeNames={(storeNames ?? []).map((s) => s.store_name)}
        canManage={canManage}
        suggestedCode={nextCode(ASSET_CODE_PREFIX, rows.map((r) => r.code))}
      />
    </div>
  );
}

// Hanya dirender untuk pemegang can_manage_posm() (lihat resolveMonitoringPosmTab);
// RLS gimmick_items menolak pembaca lain.
async function GimmickTab() {
  const supabase = await createClient();

  const [{ data: items }, { data: brands }] = await Promise.all([
    supabase
      .from("gimmick_items")
      .select(
        "id, code, name, brand_id, category, unit, pcs_per_carton, unit_cost, suggested_price, min_stock, program, is_active, brand:brands(name)"
      )
      .is("deleted_at", null)
      .order("code"),
    supabase.from("brands").select("id, name, is_active").order("name"),
  ]);

  const rows: GimmickItemListRow[] = (items ?? []).map(({ brand, ...item }) => ({
    ...item,
    unit_cost: Number(item.unit_cost),
    suggested_price: item.suggested_price === null ? null : Number(item.suggested_price),
    brand_name: (brand as { name: string } | null)?.name ?? null,
    // Mutasi gimmick menyusul di fase 2; sampai saat itu semua item boleh dihapus.
    has_movements: false,
  }));

  return (
    <GimmickItemsTable
      items={rows}
      brands={brands ?? []}
      suggestedCode={nextCode(GIMMICK_CODE_PREFIX, rows.map((r) => r.code))}
    />
  );
}

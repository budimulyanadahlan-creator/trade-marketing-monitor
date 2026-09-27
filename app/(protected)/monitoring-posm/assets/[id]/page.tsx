import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { AuditHistoryLink } from "../../audit-history-link";
import { withPreviousPlacement } from "@/lib/posm";
import { formatDate, formatIDR } from "@/lib/utils";
import { AssetConditionBadge, AssetLocation } from "../../assets-table";
import { requirePosmViewer } from "../../viewer";
import { AssetPlacementsPanel, type AssetPlacementListRow } from "./asset-placements-panel";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, canManage, isAdmin } = await requirePosmViewer();

  const [
    { data: asset },
    { data: placements },
    { count: placementCountAll },
    { data: regions },
    { data: distributors },
    { data: storeNames },
  ] = await Promise.all([
    supabase
      .from("marketing_assets")
      .select("id, code, name, asset_type, serial_number, acquisition_date, acquisition_value, brand:brands(name)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("asset_placements")
      .select(
        "id, event_date, destination, region_id, distributor_id, store_name, store_address, pic_name, condition, notes, is_registration, created_at, region:regions(name), distributor:distributors(name), creator:created_by(full_name)"
      )
      .eq("asset_id", id)
      .is("deleted_at", null),
    // Termasuk catatan terhapus, sama dengan aturan hapus asset.
    supabase.from("asset_placements").select("id", { count: "exact", head: true }).eq("asset_id", id),
    supabase.from("regions").select("id, name, is_active").order("name"),
    supabase.from("distributors").select("id, name, is_active").order("name"),
    supabase.from("asset_store_names").select("store_name").order("store_name"),
  ]);

  if (!asset || !placements?.length) notFound();

  const history = withPreviousPlacement(
    placements.map(({ region, distributor, creator, ...p }) => ({
      ...p,
      region_name: (region as { name: string } | null)?.name ?? null,
      distributor_name: (distributor as { name: string } | null)?.name ?? null,
      creator_name: (creator as { full_name: string } | null)?.full_name ?? null,
    }))
  );
  const current = history[history.length - 1];
  const rows: AssetPlacementListRow[] = history
    .map((p) => ({
      ...p,
      previous: p.previous && {
        destination: p.previous.destination,
        store_name: p.previous.store_name,
        region_name: p.previous.region_name,
        distributor_name: p.previous.distributor_name,
      },
    }))
    .reverse();

  const canDelete = (placementCountAll ?? 0) <= 1;
  const brandName = (asset.brand as { name: string } | null)?.name;
  const label = `${asset.code} — ${asset.name}`;

  const details: [string, React.ReactNode][] = [
    ["Jenis", asset.asset_type],
    ["Brand", brandName ?? "—"],
    ["Nomor Seri / Merk", asset.serial_number ?? "—"],
    ["Tanggal Perolehan", formatDate(asset.acquisition_date)],
    ["Nilai Perolehan", formatIDR(Number(asset.acquisition_value))],
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/monitoring-posm?tab=asset"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Monitoring POSM
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{asset.code}</code>
          <h1 className="text-2xl font-bold text-slate-100">{asset.name}</h1>
          <p className="text-sm text-slate-400">{asset.asset_type}</p>
          {isAdmin && <AuditHistoryLink recordId={asset.id} />}
        </div>

        <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Lokasi Terkini</p>
          <AssetLocation asset={current} />
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <AssetConditionBadge condition={current.condition} />
            <span>sejak {formatDate(current.event_date)}</span>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-white/8 bg-white/2 px-5 py-4 sm:grid-cols-5">
        {details.map(([term, value]) => (
          <div key={term} className="space-y-1">
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{term}</dt>
            <dd className="text-sm text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>

      {canManage && !canDelete && (
        <div className="flex items-start gap-2 rounded-md border border-white/8 bg-white/2 px-4 py-3 text-sm text-slate-400">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Asset ini sudah punya riwayat perpindahan sehingga tidak bisa dihapus. Jika asset sudah tidak dipakai,
            catat perpindahan dengan kondisi <span className="text-slate-200">Dihapusbukukan</span>.
          </span>
        </div>
      )}

      <AssetPlacementsPanel
        asset={{ id: asset.id, label, condition: current.condition }}
        placements={rows}
        regions={regions ?? []}
        distributors={distributors ?? []}
        storeNames={(storeNames ?? []).map((s) => s.store_name)}
        canManage={canManage}
      />
    </div>
  );
}

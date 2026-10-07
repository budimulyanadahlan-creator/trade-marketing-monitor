import { createClient } from "@/lib/supabase/server";
import { AssetTypesTable, type AssetTypeListRow } from "./asset-types-table";

export default async function AssetTypesPage() {
  const supabase = await createClient();

  // Hitungan asset termasuk yang sudah di-soft-delete (sama dengan guard hapus).
  const { data } = await supabase
    .from("asset_types")
    .select("id, name, is_active, created_at, marketing_assets(count)")
    .is("deleted_at", null)
    .order("name");

  const assetTypes: AssetTypeListRow[] = (data ?? []).map(({ marketing_assets, ...t }) => ({
    ...t,
    asset_count: (marketing_assets as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));

  return <AssetTypesTable assetTypes={assetTypes} />;
}

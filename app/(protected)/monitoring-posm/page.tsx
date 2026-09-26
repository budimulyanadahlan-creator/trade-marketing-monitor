import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { canManagePosm, nextCode, POSM_CODE_PREFIX } from "@/lib/posm";
import type { UserRole } from "@/types/database";
import { MonitoringPosmTabs, type MonitoringPosmTab } from "./monitoring-posm-tabs";
import { PosmItemsTable, type PosmItemListRow } from "./posm-items-table";

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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");
  if (profile.role === "distributor") redirect("/campaigns");

  const canManage = canManagePosm({
    role: profile.role as UserRole,
    departmentName: (profile.department as { name: string } | null)?.name,
  });

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

  const [{ data: items }, { data: brands }] = await Promise.all([
    supabase
      .from("posm_items")
      .select("id, code, name, brand_id, category, unit, min_stock, is_active, brand:brands(name)")
      .is("deleted_at", null)
      .order("code"),
    supabase.from("brands").select("id, name, is_active").order("name"),
  ]);

  const rows: PosmItemListRow[] = (items ?? []).map(({ brand, ...item }) => ({
    ...item,
    brand_name: (brand as { name: string } | null)?.name ?? null,
  }));

  return (
    <PosmItemsTable
      items={rows}
      brands={brands ?? []}
      canManage={canManage}
      suggestedCode={nextCode(POSM_CODE_PREFIX, rows.map((r) => r.code))}
    />
  );
}

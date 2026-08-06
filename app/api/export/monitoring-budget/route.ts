import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";
import { resolveFiscalPeriod, resolveMonitoringMode } from "@/lib/monitoring-budget";
import { loadMonitoringBudgetData } from "@/lib/monitoring-budget-data";
import { buildMonitoringBudgetWorkbook } from "@/lib/monitoring-budget-excel";

// Sama dengan guard halaman /monitoring-budget: hanya admin/superadmin,
// berbeda dari export Rekap lama yang juga mengizinkan finance/manager/distributor.
const ALLOWED_ROLES: UserRole[] = ["admin", "superadmin"];

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role as UserRole | undefined;
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { fiscalYear, quarter } = resolveFiscalPeriod(
    searchParams.get("fy") ?? undefined,
    searchParams.get("q") ?? undefined
  );
  const mode = resolveMonitoringMode(searchParams.get("mode") ?? undefined);

  const { aggregate } = await loadMonitoringBudgetData(supabase, { fiscalYear, quarter, mode });

  const workbook = buildMonitoringBudgetWorkbook(aggregate, mode);
  const buf = await workbook.xlsx.writeBuffer();

  const filename = `monitoring-budget-q${quarter}-${fiscalYear}-${mode}.xlsx`;

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

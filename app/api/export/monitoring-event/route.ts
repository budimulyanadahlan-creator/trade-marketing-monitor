import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseEventListFilters, todayInJakarta, type EventViewer } from "@/lib/event";
import { loadEventExportData } from "@/lib/event-data";
import { buildEventWorkbook, eventExportFilename } from "@/lib/event-excel";
import { resolveFiscalPeriod } from "@/lib/monitoring-budget";
import type { UserRole } from "@/types/database";

// Sama dengan guard halaman /monitoring-event: semua role yang login boleh
// export, termasuk distributor. Role diperiksa di server untuk menentukan
// kolom: distributor hanya mendapat event yang boleh dilihatnya (RLS migrasi
// 059 + canViewEvent) tanpa biaya, nilai sampling, maupun vendor.
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
    .select("role, region_id, distributor_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const viewer: EventViewer = {
    role: profile.role as UserRole,
    region_id: profile.region_id,
    distributor_id: profile.distributor_id,
  };

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const period = resolveFiscalPeriod(params.fy, params.q);
  const data = await loadEventExportData(supabase, {
    period,
    filters: parseEventListFilters(params),
    viewer,
    today: todayInJakarta(),
  });

  const buf = await buildEventWorkbook(data).xlsx.writeBuffer();

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${eventExportFilename(period.fiscalYear, period.quarter)}"`,
    },
  });
}

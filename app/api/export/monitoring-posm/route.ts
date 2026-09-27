import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManagePosm, parsePosmExportParams } from "@/lib/posm";
import { parseGimmickExportParams } from "@/lib/gimmick";
import { loadPosmExportData } from "@/lib/posm-export-data";
import { loadGimmickExportData } from "@/lib/gimmick-export-data";
import { buildPosmWorkbook } from "@/lib/posm-excel";
import { addGimmickSheets } from "@/lib/gimmick-excel";
import type { UserRole } from "@/types/database";

function todayInJakarta() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

// Sama dengan guard halaman /monitoring-posm: semua role yang login kecuali
// distributor boleh export (hak baca, tanpa region-lock). Sheet gimmick hanya
// untuk pemegang can_manage_posm(); pemanggil lain tidak memicu query gimmick.
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
    .select("role, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role === "distributor") {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const includeGimmick = canManagePosm({
    role: profile.role as UserRole,
    departmentName: (profile.department as { name: string } | null)?.name,
  });

  const today = todayInJakarta();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parsePosmExportParams(params, today);

  const [data, gimmick] = await Promise.all([
    loadPosmExportData(supabase, filters),
    includeGimmick ? loadGimmickExportData(supabase, parseGimmickExportParams(params, today)) : null,
  ]);

  const wb = buildPosmWorkbook(data);
  if (gimmick) addGimmickSheets(wb, gimmick);
  const buf = await wb.xlsx.writeBuffer();

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="monitoring-posm-${today}.xlsx"`,
    },
  });
}

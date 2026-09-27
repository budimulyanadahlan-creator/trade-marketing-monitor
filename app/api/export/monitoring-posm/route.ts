import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parsePosmExportParams } from "@/lib/posm";
import { loadPosmExportData } from "@/lib/posm-export-data";
import { buildPosmWorkbook } from "@/lib/posm-excel";

function todayInJakarta() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

// Sama dengan guard halaman /monitoring-posm: semua role yang login kecuali
// distributor boleh export (hak baca, tanpa region-lock).
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

  if (!profile || profile.role === "distributor") {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const today = todayInJakarta();
  const filters = parsePosmExportParams(
    Object.fromEntries(new URL(request.url).searchParams),
    today
  );

  const data = await loadPosmExportData(supabase, filters);
  const buf = await buildPosmWorkbook(data).xlsx.writeBuffer();

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="monitoring-posm-${today}.xlsx"`,
    },
  });
}

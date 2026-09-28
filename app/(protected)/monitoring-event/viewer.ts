import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventViewer } from "@/lib/event";
import { canManagePosm } from "@/lib/posm";
import type { UserRole } from "@/types/database";

/**
 * Guard halaman Monitoring Event: wajib login; semua role boleh membaca,
 * termasuk distributor (baris dibatasi RLS migrasi 059). `showCosts` false
 * untuk distributor: halaman tidak meminta maupun merender biaya, nilai
 * sampling, vendor, dan KPI budget.
 */
export async function requireEventViewer() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, region_id, distributor_id, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  const role = profile.role as UserRole;
  const viewer: EventViewer = { role, region_id: profile.region_id, distributor_id: profile.distributor_id };

  // canManagePosm selalu false untuk distributor.
  const canManage = canManagePosm({
    role,
    departmentName: (profile.department as { name: string } | null)?.name,
  });

  // Audit log hanya untuk admin/superadmin (sama dengan RLS posm_audit_log).
  const isAdmin = role === "admin" || role === "superadmin";

  return { supabase, viewer, showCosts: role !== "distributor", canManage, isAdmin };
}

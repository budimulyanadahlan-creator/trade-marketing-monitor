import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManagePosm } from "@/lib/posm";
import type { UserRole } from "@/types/database";

/**
 * Guard halaman Monitoring POSM: wajib login, distributor dialihkan, dan
 * kembalikan apakah viewer boleh menulis (tombol aksi).
 */
export async function requirePosmViewer() {
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

  return { supabase, canManage };
}

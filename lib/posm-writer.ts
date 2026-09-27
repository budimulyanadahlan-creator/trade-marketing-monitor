import { createClient } from "@/lib/supabase/server";
import { canManagePosm } from "@/lib/posm";
import type { UserRole } from "@/types/database";

// Guard server action POSM/asset/gimmick. RLS (can_manage_posm) tetap jadi
// penjaga akhir; cek ini untuk pesan ramah dan menghindari round-trip yang
// pasti ditolak.
export async function requirePosmWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    !canManagePosm({
      role: profile.role as UserRole,
      departmentName: (profile.department as { name: string } | null)?.name,
    })
  ) {
    throw new Error("Forbidden");
  }

  return { supabase };
}

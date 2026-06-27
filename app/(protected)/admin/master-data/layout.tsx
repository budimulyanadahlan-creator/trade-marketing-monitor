import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MasterDataNav } from "./master-data-nav";

export default async function MasterDataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "superadmin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Master Data</h1>
        <p className="text-slate-400 text-sm mt-1">
          Kelola data referensi: Brand, Region, Channel, Kategori Promosi, Vendor, Budget
        </p>
      </div>
      <MasterDataNav />
      {children}
    </div>
  );
}

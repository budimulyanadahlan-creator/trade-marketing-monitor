import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsClient } from "./approvals-client";
import type { CampaignRow } from "@/types/database";

export type SubmittedCampaign = CampaignRow & {
  department: { name: string } | null;
  brand: { name: string } | null;
  region: { name: string } | null;
  campaign_files: { id: string }[];
};

const SELECT_FIELDS = `
  *,
  department:departments(name),
  brand:brands(name),
  region:regions(name),
  campaign_files(id)
`;

export default async function ApprovalsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) redirect("/login");

  if (!["admin", "superadmin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const { data } = await supabase
    .from("campaigns")
    .select(SELECT_FIELDS)
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  const campaigns = (data ?? []) as unknown as SubmittedCampaign[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Persetujuan</h1>
        <p className="text-slate-400 text-sm">
          {campaigns.length === 0
            ? "Tidak ada SKP yang menunggu persetujuan."
            : `${campaigns.length} SKP menunggu persetujuan.`}
        </p>
      </div>

      <ApprovalsClient campaigns={campaigns} />
    </div>
  );
}

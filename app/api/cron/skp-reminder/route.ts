import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSkpPendingDigestEmail, type PendingSkpItem } from "@/lib/email";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function getPendingDigestData(adminClient: AdminClient) {
  const { data: campaigns } = await adminClient
    .from("campaigns")
    .select("id, name, submitted_at, department:departments(name)")
    .eq("status", "submitted");

  const pendingItems: PendingSkpItem[] = (campaigns ?? []).map((c) => ({
    campaignId: c.id,
    campaignName: c.name,
    departmentName: c.department?.name ?? null,
    submittedAt: c.submitted_at ?? new Date().toISOString(),
  }));

  if (pendingItems.length === 0) {
    return { pendingItems, recipients: [] };
  }

  const { data: adminUsers } = await adminClient
    .from("users")
    .select("id, full_name")
    .in("role", ["admin", "superadmin"])
    .eq("is_active", true);

  let recipients: { email: string; name: string }[] = [];
  if (adminUsers && adminUsers.length > 0) {
    const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const adminIdSet = new Set(adminUsers.map((u) => u.id));
    const nameById = Object.fromEntries(adminUsers.map((u) => [u.id, u.full_name]));

    recipients = (authData?.users ?? [])
      .filter((u) => adminIdSet.has(u.id) && u.email)
      .map((u) => ({ email: u.email!, name: nameById[u.id] ?? u.email! }));
  }

  return { pendingItems, recipients };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { pendingItems, recipients } = await getPendingDigestData(adminClient);

  if (pendingItems.length === 0) {
    return NextResponse.json({ sent: false, pendingCount: 0 });
  }

  if (recipients.length > 0) {
    await sendSkpPendingDigestEmail({ to: recipients, pendingItems });
  }

  return NextResponse.json({
    sent: recipients.length > 0,
    pendingCount: pendingItems.length,
    recipientCount: recipients.length,
  });
}

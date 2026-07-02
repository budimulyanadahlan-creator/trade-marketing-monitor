import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole, CampaignStatus } from "@/types/database";
import { RekapClient } from "./rekap-client";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function strArr(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export type RekapCampaign = {
  id: string;
  name: string;
  skp_number: string | null;
  status: CampaignStatus;
  requested_budget: number;
  actual_spent: number;
  sales_projection: number;
  objective: string | null;
  mechanism: string;
  store_id: string | null;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  created_at: string;
  department: { name: string } | null;
  brand: { name: string } | null;
  region: { name: string } | null;
  channel: { name: string } | null;
  promotion_category: { name: string; account_code: string } | null;
  action_approval: { name: string } | null;
  vendor: { name: string } | null;
  realizations: { id: string; invoice_number: string; amount: number; realization_date: string }[];
};

const ALLOWED_ROLES: UserRole[] = ["admin", "finance", "superadmin", "distributor"];

const CAMPAIGN_SELECT = `
  id, name, skp_number, status, requested_budget, actual_spent, sales_projection,
  mechanism, objective, store_id, start_date, end_date, submitted_at, created_at,
  department:departments(name),
  brand:brands(name),
  region:regions(name),
  channel:channels(name),
  promotion_category:promotion_categories(name, account_code),
  action_approval:action_approvals(name),
  vendor:vendors(name),
  realizations(id, invoice_number, amount, realization_date)
`;

export default async function RekapPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, department_id, region_id, is_active")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role as UserRole)) {
    redirect("/dashboard");
  }

  const role = profile.role as UserRole;
  const isDistributor = role === "distributor";
  const params = await searchParams;
  const dateFrom = str(params.date_from);
  const dateTo = str(params.date_to);

  let query = supabase
    .from("campaigns")
    .select(CAMPAIGN_SELECT)
    .order("created_at", { ascending: false });

  let receiptedCampaignIds: string[] = [];

  if (isDistributor) {
    query = query.eq("status", "approved");

    // Restrict to Sales and Trade Marketing departments
    const { data: allDepts } = await supabase.from("departments").select("id, name");
    const targetDeptIds = (allDepts ?? [])
      .filter((d) => {
        const n = d.name.toLowerCase();
        return n.includes("sales") || n.includes("trade");
      })
      .map((d) => d.id);
    if (targetDeptIds.length > 0) query = query.in("department_id", targetDeptIds);

    if (dateFrom) query = query.gte("start_date", dateFrom);
    if (dateTo) query = query.lte("start_date", dateTo);

    const { data: receipts } = await supabase
      .from("distributor_receipts")
      .select("campaign_id")
      .eq("received_by", user.id);
    receiptedCampaignIds = receipts?.map((r) => r.campaign_id) ?? [];
  } else {
    const statusFilters = strArr(params.status) as CampaignStatus[];
    const brandId = str(params.brand);
    const regionId = str(params.region);
    const departmentId = str(params.department);
    const actionApprovalId = str(params.action_approval);

    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (brandId) query = query.eq("brand_id", brandId);
    if (regionId) query = query.eq("region_id", regionId);
    if (departmentId) query = query.eq("department_id", departmentId);
    if (actionApprovalId) query = query.eq("action_approval_id", actionApprovalId);
    if (dateFrom) query = query.gte("start_date", dateFrom);
    if (dateTo) query = query.lte("start_date", dateTo);
  }

  const { data: campaigns } = await query;

  const [
    { data: departments },
    { data: brands },
    { data: regions },
    { data: actionApprovals },
  ] = !isDistributor
    ? await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
        supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
        supabase.from("action_approvals").select("id, name").order("name"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  // For admin/finance/superadmin: fetch all campaign IDs that have any distributor receipt
  if (!isDistributor) {
    const { data: allReceipts } = await supabase
      .from("distributor_receipts")
      .select("campaign_id");
    receiptedCampaignIds = [...new Set((allReceipts ?? []).map((r) => r.campaign_id))];
  }

  const statusFilters = !isDistributor ? (strArr(params.status) as CampaignStatus[]) : [];

  return (
    <RekapClient
      campaigns={(campaigns ?? []) as unknown as RekapCampaign[]}
      departments={departments ?? []}
      brands={brands ?? []}
      regions={regions ?? []}
      actionApprovals={actionApprovals ?? []}
      userRole={role}
      isDistributor={isDistributor}
      receiptedCampaignIds={receiptedCampaignIds}
      filters={{
        status: statusFilters,
        brand: !isDistributor ? str(params.brand) : "",
        region: !isDistributor ? str(params.region) : "",
        department: !isDistributor ? str(params.department) : "",
        action_approval: !isDistributor ? str(params.action_approval) : "",
        date_from: dateFrom,
        date_to: dateTo,
      }}
    />
  );
}

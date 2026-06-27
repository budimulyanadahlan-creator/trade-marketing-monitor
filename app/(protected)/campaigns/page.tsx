import { createClient } from "@/lib/supabase/server";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("role, department_id, region_id")
    .eq("id", user.id)
    .single();

  const isDistributor = profile?.role === "distributor";

  // Fetch department name upfront — needed for region-lock logic
  let deptName: string | null = null;
  if (profile?.department_id) {
    const { data: dept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", profile.department_id)
      .single();
    deptName = dept?.name?.toLowerCase() ?? null;
  }

  // Distributors in finance/controller dept are not region-locked (can see all regions)
  const REGION_EXEMPT_DEPTS = ["finance", "controller"];
  const distributorRegionExempt =
    isDistributor && REGION_EXEMPT_DEPTS.includes(deptName ?? "");

  // Distributors only see campaigns from the Sales department
  let salesDeptIds: string[] = [];
  if (isDistributor) {
    const { data: salesDepts } = await supabase
      .from("departments")
      .select("id")
      .ilike("name", "sales");
    salesDeptIds = salesDepts?.map((d) => d.id) ?? [];
  }

  // Fetch campaigns with joined display names
  let campaignQuery = supabase
    .from("campaigns")
    .select(
      `
      *,
      department:departments(name),
      brand:brands(name),
      region:regions(name),
      channel:channels(name),
      promotion_category:promotion_categories(name, account_code),
      action_approval:action_approvals(name),
      vendor:vendors(name),
      realizations(id)
    `
    )
    .order("created_at", { ascending: false });

  if (isDistributor) {
    campaignQuery = campaignQuery.eq("status", "approved");
    if (salesDeptIds.length > 0) {
      campaignQuery = campaignQuery.in("department_id", salesDeptIds);
    }
    if (!distributorRegionExempt && profile?.region_id) {
      campaignQuery = campaignQuery.eq("region_id", profile.region_id);
    }
  }

  const { data: campaigns } = await campaignQuery;

  // Fetch receipted campaign IDs for distributor (to show Status Penerimaan column)
  let receiptedCampaignIds: string[] = [];
  if (isDistributor) {
    const { data: receipts } = await supabase
      .from("distributor_receipts")
      .select("campaign_id")
      .eq("received_by", user.id);
    receiptedCampaignIds = receipts?.map((r) => r.campaign_id) ?? [];
  }

  // Determine locked region for the form: regular distributor + Sales dept are locked
  let lockedRegionId: string | null = null;
  if (isDistributor && !distributorRegionExempt && profile?.region_id) {
    lockedRegionId = profile.region_id;
  } else if (!isDistributor && deptName === "sales" && profile?.region_id) {
    lockedRegionId = profile.region_id;
  }

  // Master data for the new campaign form
  const [
    { data: departments },
    { data: brands },
    { data: regions },
    { data: channels },
    { data: categories },
    { data: actionApprovals },
    { data: vendors },
    { data: masterBudgets },
  ] = await Promise.all([
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
    supabase.from("channels").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("promotion_categories")
      .select("id, name, type, account_code")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("action_approvals")
      .select("id, name, brand_id, start_date, end_date, target_budget")
      .order("name"),
    supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("master_budgets")
      .select("id, promotion_category_id, fiscal_year, quarter, total_amount")
      .order("fiscal_year", { ascending: false }),
  ]);

  return (
    <CampaignsClient
      campaigns={campaigns ?? []}
      userRole={profile?.role ?? "user"}
      departments={departments ?? []}
      brands={brands ?? []}
      regions={regions ?? []}
      channels={channels ?? []}
      categories={categories ?? []}
      actionApprovals={actionApprovals ?? []}
      vendors={vendors ?? []}
      masterBudgets={masterBudgets ?? []}
      lockedRegionId={lockedRegionId}
      receiptedCampaignIds={receiptedCampaignIds}
    />
  );
}

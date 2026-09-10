import { createClient } from "@/lib/supabase/server";
import { computeChecklistReadinessByCampaignId } from "@/lib/claim-checklist-status";
import { computeClaimVerificationProgressByCampaignId } from "@/lib/claim-verification-progress";
import { CampaignsClient } from "./campaigns-client";
import type { ClaimItemStatus, UserRole } from "@/types/database";

export default async function CampaignsPage() {
  const supabase = await createClient();

  // Master data for the new campaign form doesn't depend on the logged-in
  // user at all — fire it off immediately so it runs concurrently with
  // everything below instead of waiting until the very end
  // (plans/perf-skp-pages.md, Fase 1b). Awaited just before it's needed for
  // the final render.
  const masterDataPromise = Promise.all([
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
      .select(
        "id, name, brand_id, start_date, end_date, target_budget, master_budget:master_budgets(promotion_category_id)"
      )
      .order("name"),
    supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
    supabase.from("distributors").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("master_budgets")
      .select("id, promotion_category_id, fiscal_year, quarter, total_amount")
      .order("fiscal_year", { ascending: false }),
  ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Profile (role + department name via nested select, one round-trip
  // instead of two) and the full department list (only needed for
  // distributors below, but fetched for everyone to keep this batched —
  // departments is a tiny table) are independent of each other.
  const [{ data: profileRaw }, { data: allDepts }] = await Promise.all([
    supabase
      .from("users")
      .select("role, department_id, region_id, department:departments(name)")
      .eq("id", user.id)
      .single(),
    supabase.from("departments").select("id, name"),
  ]);
  const profile = profileRaw as
    | {
        role: UserRole;
        department_id: string | null;
        region_id: string | null;
        department: { name: string } | null;
      }
    | null;

  const isDistributor = profile?.role === "distributor";
  const deptName = profile?.department?.name?.toLowerCase() ?? null;

  // Distributors in finance/controller dept are not region-locked (can see all regions)
  const REGION_EXEMPT_DEPTS = ["finance", "controller"];
  const distributorRegionExempt =
    isDistributor && REGION_EXEMPT_DEPTS.includes(deptName ?? "");

  // Distributors only see campaigns from the Sales and Trade Marketing departments
  let visibleDeptIds: string[] = [];
  if (isDistributor) {
    const allowedDeptNames = ["sales", "trade marketing"];
    visibleDeptIds = (allDepts ?? [])
      .filter((d) => allowedDeptNames.includes((d.name ?? "").toLowerCase()))
      .map((d) => d.id);
  }

  // Fetch campaigns with joined display names. Needs isDistributor +
  // visibleDeptIds from above, so this stays sequential — can't be batched
  // with the block that produces them.
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
      distributor:distributors(name),
      realizations(id)
    `
    )
    .order("created_at", { ascending: false });

  if (isDistributor) {
    campaignQuery = campaignQuery.eq("status", "approved");
    if (visibleDeptIds.length > 0) {
      campaignQuery = campaignQuery.in("department_id", visibleDeptIds);
    }
  }

  const { data: campaigns } = await campaignQuery;

  // Checklist readiness (approved SKP only) — tells admin/finance/manager which
  // approved SKP already has 100% of its distributor claim-document checklist
  // filled in, so they know it's ready for "Tambah" (realisasi) to move it to
  // ongoing. Not relevant for the distributor's own list (already filtered to
  // approved, and it's their own checklist they're filling in).
  //
  // Claim verification progress (claim_submitted only) — the finance queue's
  // "N/M item ✓" / "menunggu revisi distributor" badge.
  //
  // Both batch-fetched in one query each rather than per-row, and — since
  // "approved" and "claim_submitted" campaigns are disjoint sets — the two
  // are independent of each other, so both round-trips fire together.
  let checklistStatusByCampaignId: Record<string, { required: number; fulfilled: number }> = {};
  let claimVerificationProgressByCampaignId: Record<
    string,
    { total: number; accepted: number; hasRevisionRequested: boolean }
  > = {};

  if (!isDistributor) {
    const approvedCampaigns = (campaigns ?? []).filter((c) => c.status === "approved");
    const categoryIds = [
      ...new Set(
        approvedCampaigns
          .map((c) => c.promotion_category_id)
          .filter((id): id is string => !!id)
      ),
    ];
    const campaignIds = approvedCampaigns.map((c) => c.id);
    const claimSubmittedCampaignIds = (campaigns ?? [])
      .filter((c) => c.status === "claim_submitted")
      .map((c) => c.id);

    const wantsChecklist = categoryIds.length > 0 && campaignIds.length > 0;
    const wantsClaimProgress = claimSubmittedCampaignIds.length > 0;

    const [{ data: requirementsRaw }, { data: checklistsRaw }, { data: claimItemsRaw }] =
      await Promise.all([
        wantsChecklist
          ? supabase
              .from("claim_requirements")
              .select("promotion_category_id, document_type_id")
              .in("promotion_category_id", categoryIds)
          : Promise.resolve({ data: [] as { promotion_category_id: string; document_type_id: string }[] }),
        wantsChecklist
          ? supabase
              .from("distributor_claim_checklists")
              .select("campaign_id, document_type_id, is_fulfilled")
              .in("campaign_id", campaignIds)
          : Promise.resolve({
              data: [] as { campaign_id: string; document_type_id: string; is_fulfilled: boolean }[],
            }),
        wantsClaimProgress
          ? supabase
              .from("claim_item_verifications")
              .select("campaign_id, status")
              .in("campaign_id", claimSubmittedCampaignIds)
          : Promise.resolve({ data: [] as { campaign_id: string; status: ClaimItemStatus }[] }),
      ]);

    if (wantsChecklist) {
      checklistStatusByCampaignId = computeChecklistReadinessByCampaignId({
        campaigns: approvedCampaigns.map((c) => ({
          id: c.id,
          promotion_category_id: c.promotion_category_id,
        })),
        requirements: requirementsRaw ?? [],
        checklists: checklistsRaw ?? [],
      });
    }
    if (wantsClaimProgress) {
      claimVerificationProgressByCampaignId = computeClaimVerificationProgressByCampaignId(
        claimItemsRaw ?? []
      );
    }
  }

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

  const [
    { data: departments },
    { data: brands },
    { data: regions },
    { data: channels },
    { data: categories },
    { data: actionApprovals },
    { data: vendors },
    { data: distributors },
    { data: masterBudgets },
  ] = await masterDataPromise;

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
      distributors={distributors ?? []}
      masterBudgets={masterBudgets ?? []}
      lockedRegionId={lockedRegionId}
      receiptedCampaignIds={receiptedCampaignIds}
      checklistStatusByCampaignId={checklistStatusByCampaignId}
      claimVerificationProgressByCampaignId={claimVerificationProgressByCampaignId}
    />
  );
}

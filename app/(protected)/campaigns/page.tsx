import { createClient } from "@/lib/supabase/server";
import { DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES } from "@/lib/campaign-status";
import { computeChecklistReadinessByCampaignId } from "@/lib/claim-checklist-status";
import { computeClaimVerificationProgressByCampaignId } from "@/lib/claim-verification-progress";
import { distributorCampaignAccess } from "@/lib/distributor-campaign-guard";
import { isCampaignWithoutDistributor } from "@/lib/campaign-distributor-required";
import { CampaignsClient } from "./campaigns-client";
import type { ClaimItemStatus, DistributorScope, UserRole } from "@/types/database";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ distributor?: string }>;
}) {
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

  // Profile: role + department name via nested select (one round-trip), plus
  // the distributor fields the access module needs (perusahaan, cakupan,
  // region) for the per-row "hanya lihat" decision below.
  const { data: profileRaw } = await supabase
    .from("users")
    .select(
      "role, department_id, region_id, distributor_id, distributor_scope, department:departments(name)"
    )
    .eq("id", user.id)
    .single();
  const profile = profileRaw as
    | {
        role: UserRole;
        department_id: string | null;
        region_id: string | null;
        distributor_id: string | null;
        distributor_scope: DistributorScope | null;
        department: { name: string } | null;
      }
    | null;

  const isDistributor = profile?.role === "distributor";
  const deptName = profile?.department?.name?.toLowerCase() ?? null;

  // Visibilitas distributor (perusahaan × cakupan × region × induk, departemen
  // Sales/TM, jendela status) ditegakkan oleh RLS lewat fungsi
  // distributor_campaign_access (migrasi 067) — tidak difilter ulang di sini
  // agar aturannya tidak terduplikasi. Filter status tetap dipasang karena
  // menyempitkan query dan sama persis dengan jendela RLS.
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
      distributor:distributors(name, parent_distributor_id),
      realizations(id)
    `
    )
    .order("created_at", { ascending: false });

  if (isDistributor) {
    campaignQuery = campaignQuery.in("status", DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES);
  }

  const { data: campaigns } = await campaignQuery;

  // Filter khusus admin `?distributor=none` (Fase 5 multi-user distributor):
  // SKP Sales/TM berstatus Disetujui s.d. Selesai yang belum punya distributor,
  // yaitu SKP yang tidak terlihat oleh distributor mana pun.
  const { distributor: distributorParam } = await searchParams;
  const isAdminOrSuperadmin = profile?.role === "admin" || profile?.role === "superadmin";
  const noDistributorOnly = isAdminOrSuperadmin && distributorParam === "none";
  const listedCampaigns = noDistributorOnly
    ? (campaigns ?? []).filter((c) =>
        isCampaignWithoutDistributor({
          distributor_id: c.distributor_id,
          status: c.status,
          departmentName: (c.department as { name?: string } | null)?.name,
        })
      )
    : (campaigns ?? []);

  // SKP yang hanya boleh dilihat (Pusat perusahaan induk melihat SKP anak
  // perusahaan): tombol aksi di daftar disembunyikan untuk ID ini.
  const readOnlyCampaignIds: string[] = [];
  if (isDistributor && profile) {
    for (const c of campaigns ?? []) {
      const access = distributorCampaignAccess(
        {
          distributor_id: c.distributor_id ?? null,
          region_id: c.region_id ?? null,
          distributor_parent_id:
            (c.distributor as { parent_distributor_id?: string | null } | null)
              ?.parent_distributor_id ?? null,
        },
        profile
      );
      if (access === "view") readOnlyCampaignIds.push(c.id);
    }
  }

  // Checklist readiness (approved SKP only) — tells admin/finance/manager which
  // approved SKP already has 100% of its distributor claim-document checklist
  // filled in, so they know it's ready for "Tambah" (realisasi) to move it to
  // ongoing. Not relevant for the distributor's own list (it's their own
  // checklist they're filling in).
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
  // Penerimaan milik SKP (Fase 8 multi-user distributor): rekan satu
  // perusahaan melihat status yang sama; RLS membatasi ke SKP yang terlihat.
  if (isDistributor) {
    const { data: receipts } = await supabase
      .from("distributor_receipts")
      .select("campaign_id");
    receiptedCampaignIds = receipts?.map((r) => r.campaign_id) ?? [];
  }

  // Determine locked region for the form: cabang distributor + Sales dept are locked
  let lockedRegionId: string | null = null;
  if (isDistributor && profile?.distributor_scope !== "pusat" && profile?.region_id) {
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
      campaigns={listedCampaigns}
      noDistributorOnly={noDistributorOnly}
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
      readOnlyCampaignIds={readOnlyCampaignIds}
      checklistStatusByCampaignId={checklistStatusByCampaignId}
      claimVerificationProgressByCampaignId={claimVerificationProgressByCampaignId}
    />
  );
}

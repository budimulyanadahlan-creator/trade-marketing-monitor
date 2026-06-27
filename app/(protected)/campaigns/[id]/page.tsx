import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CampaignDetailClient } from "./campaign-detail-client";
import type { CampaignRow, CampaignFileRow, ApprovalHistoryRow, RealizationRow, DistributorReceiptRow, UserRole } from "@/types/database";

export type ClaimDocument = {
  documentTypeId: string;
  name: string;
  isFulfilled: boolean;
};

type ApprovalHistoryWithActor = ApprovalHistoryRow & {
  actor: { full_name: string } | null;
};

type CampaignWithJoins = CampaignRow & {
  department: { name: string } | null;
  brand: { name: string } | null;
  region: { name: string } | null;
  channel: { name: string } | null;
  promotion_category: { name: string; account_code: string } | null;
  action_approval: { name: string } | null;
  vendor: { name: string } | null;
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const userRole = (userProfile?.role ?? "user") as UserRole;

  const { data: campaignRaw } = await supabase
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
      vendor:vendors(name)
    `
    )
    .eq("id", id)
    .single();

  if (!campaignRaw) notFound();
  const campaign = campaignRaw as unknown as CampaignWithJoins;

  const { data: filesRaw } = await supabase
    .from("campaign_files")
    .select("*")
    .eq("campaign_id", id)
    .order("uploaded_at");
  const files = (filesRaw ?? []) as CampaignFileRow[];

  const { data: historyRaw } = await supabase
    .from("approval_history")
    .select("*, actor:users!approval_history_actor_id_fkey(full_name)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  const approvalHistory = (historyRaw ?? []) as unknown as ApprovalHistoryWithActor[];

  const { data: realizationsRaw } = await supabase
    .from("realizations")
    .select("*, creator:created_by(full_name)")
    .eq("campaign_id", id)
    .order("realization_date", { ascending: true });
  const realizations = (realizationsRaw ?? []) as (RealizationRow & {
    creator: { full_name: string } | null;
  })[];

  // Fetch distributor receipts (visible to distributor + admin/superadmin)
  const showReceipts = ["distributor", "admin", "superadmin"].includes(userRole);
  const { data: receiptsRaw } = showReceipts
    ? await supabase
        .from("distributor_receipts")
        .select("*, receiver:received_by(full_name)")
        .eq("campaign_id", id)
        .order("received_at", { ascending: true })
    : { data: [] };
  const distributorReceipts = (receiptsRaw ?? []) as (DistributorReceiptRow & {
    receiver: { full_name: string } | null;
  })[];

  // Claim checklist data (distributor, admin, superadmin, finance, manager)
  const showClaimSection = ["distributor", "admin", "superadmin", "finance", "manager"].includes(userRole);
  let claimDocuments: ClaimDocument[] = [];

  if (showClaimSection && campaign.promotion_category_id) {
    const { data: requirementsRaw } = await supabase
      .from("claim_requirements")
      .select("document_type_id, claim_document_types(name, sort_order)")
      .eq("promotion_category_id", campaign.promotion_category_id);

    if (requirementsRaw && requirementsRaw.length > 0) {
      const docs = requirementsRaw
        .map((r) => {
          const dt = r.claim_document_types as { name: string; sort_order: number } | null;
          return {
            documentTypeId: r.document_type_id,
            name: dt?.name ?? "",
            sortOrder: dt?.sort_order ?? 999,
          };
        })
        .filter((d) => d.name)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const { data: checklistsRaw } = await supabase
        .from("distributor_claim_checklists")
        .select("document_type_id, is_fulfilled")
        .eq("campaign_id", id);

      // True if any distributor has fulfilled the document (admin view) or own entry (distributor view via RLS)
      const fulfilledMap = new Map<string, boolean>();
      for (const row of checklistsRaw ?? []) {
        if (row.is_fulfilled) {
          fulfilledMap.set(row.document_type_id, true);
        } else if (!fulfilledMap.has(row.document_type_id)) {
          fulfilledMap.set(row.document_type_id, false);
        }
      }

      claimDocuments = docs.map((d) => ({
        documentTypeId: d.documentTypeId,
        name: d.name,
        isFulfilled: fulfilledMap.get(d.documentTypeId) ?? false,
      }));
    }
  }

  // Master data only needed if editable
  const isEditable =
    campaign.status === "draft" || campaign.status === "rejected";

  const [
    { data: departments },
    { data: brands },
    { data: regions },
    { data: channels },
    { data: categories },
    { data: actionApprovals },
    { data: vendors },
    { data: masterBudgets },
  ] = isEditable
    ? await Promise.all([
        supabase.from("departments").select("id, name").order("name"),
        supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
        supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
        supabase.from("channels").select("id, name").eq("is_active", true).order("name"),
        supabase
          .from("promotion_categories")
          .select("id, name, type, account_code")
          .eq("is_active", true)
          .order("name"),
        supabase.from("action_approvals").select("id, name, brand_id, start_date, end_date, target_budget").order("name"),
        supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
        supabase
          .from("master_budgets")
          .select("id, promotion_category_id, fiscal_year, quarter, total_amount")
          .order("fiscal_year", { ascending: false }),
      ])
    : [
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
        { data: [] },
      ];

  return (
    <CampaignDetailClient
      campaign={campaign}
      files={files}
      approvalHistory={approvalHistory}
      realizations={realizations}
      distributorReceipts={distributorReceipts}
      claimDocuments={claimDocuments}
      isEditable={isEditable}
      userRole={userRole}
      departments={departments ?? []}
      brands={brands ?? []}
      regions={regions ?? []}
      channels={channels ?? []}
      categories={categories ?? []}
      actionApprovals={actionApprovals ?? []}
      vendors={vendors ?? []}
      masterBudgets={masterBudgets ?? []}
    />
  );
}

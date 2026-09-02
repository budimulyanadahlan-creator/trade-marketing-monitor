import { notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { computeAARemainingBudget } from "@/lib/campaign-status";
import { ensureClaimItemVerifications } from "@/lib/claim-item-verifications";
import { CampaignDetailClient } from "./campaign-detail-client";
import type { CampaignRow, CampaignFileRow, ApprovalHistoryRow, RealizationRow, DistributorReceiptRow, ClaimEventRow, ClaimItemStatus, UserRole, CampaignStatus } from "@/types/database";

export type ClaimDocumentFile = {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
};

// Verification decision on one claim item (a document, or the nominal
// amount) — Phase 2 (Verifikasi Klaim oleh Finance).
export type ClaimItemVerificationInfo = {
  id: string;
  status: ClaimItemStatus;
  note: string | null;
  actorName: string | null;
  decidedAt: string | null;
};

export type ClaimDocument = {
  documentTypeId: string;
  name: string;
  isFulfilled: boolean;
  files: ClaimDocumentFile[];
  verification: ClaimItemVerificationInfo | null;
};

// Info budget AA untuk approver: dihitung server-side saat halaman dimuat.
// Hanya dikirim ke client untuk role approver — angka sisa tidak boleh
// sampai ke pengaju/distributor.
export type AABudgetInfo = {
  remaining: number;
  exceeded: boolean;
  shortfall: number;
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
  distributor: { name: string } | null;
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
      vendor:vendors(name),
      distributor:distributors(name)
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

  // Riwayat ajukan/batalkan klaim — visible to whoever the RLS policy on
  // claim_events lets see this campaign's events (admin/superadmin/finance/
  // manager always, distributor for their own visible SKP).
  const { data: claimEventsRaw } = await supabase
    .from("claim_events")
    .select("*, actor:actor_id(full_name)")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });
  const claimEvents = (claimEventsRaw ?? []) as (ClaimEventRow & {
    actor: { full_name: string } | null;
  })[];

  // Claim checklist data. "user" is included from Phase 2 onward so the SKP
  // creator can see per-item verification status/notes read-only (PRD story
  // 18) — RLS still scopes their view to campaigns they created.
  const showClaimSection = ["distributor", "admin", "superadmin", "finance", "manager", "user"].includes(userRole);
  let claimDocuments: ClaimDocument[] = [];

  // Per-item verification (Phase 2): status/note/actor per document, plus
  // one row for the nominal claim amount (item_type = 'amount').
  const ITEM_VERIFICATION_STATUSES: CampaignStatus[] = [
    "claim_submitted", "claim_verified", "ready_to_pay", "paid", "completed",
  ];
  const verificationByDocType = new Map<string, ClaimItemVerificationInfo>();
  let claimAmountVerification: ClaimItemVerificationInfo | null = null;

  if (showClaimSection && ITEM_VERIFICATION_STATUSES.includes(campaign.status)) {
    // Self-heal: creates any missing item rows (documents + nominal) so a
    // claim that was already claim_submitted when this feature shipped
    // still gets a full set to verify, per the PRD's transition note.
    if (campaign.status === "claim_submitted") {
      try {
        await ensureClaimItemVerifications(
          createAdminClient(),
          id,
          campaign.promotion_category_id
        );
      } catch (syncErr) {
        console.error("[CampaignDetailPage] claim_item_verifications sync error:", syncErr);
      }
    }

    const { data: itemsRaw } = await supabase
      .from("claim_item_verifications")
      .select("id, item_type, document_type_id, status, note, decided_at, actor:actor_id(full_name)")
      .eq("campaign_id", id);

    for (const row of (itemsRaw ?? []) as unknown as {
      id: string;
      item_type: "document" | "amount";
      document_type_id: string | null;
      status: ClaimItemStatus;
      note: string | null;
      decided_at: string | null;
      actor: { full_name: string } | null;
    }[]) {
      const info: ClaimItemVerificationInfo = {
        id: row.id,
        status: row.status,
        note: row.note,
        actorName: row.actor?.full_name ?? null,
        decidedAt: row.decided_at,
      };
      if (row.item_type === "amount") {
        claimAmountVerification = info;
      } else if (row.document_type_id) {
        verificationByDocType.set(row.document_type_id, info);
      }
    }
  }

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

      // Claim document files (document_type_id set) grouped per checklist item.
      const claimFilesByDocType = new Map<string, ClaimDocumentFile[]>();
      for (const f of (filesRaw ?? []) as CampaignFileRow[]) {
        if (!f.document_type_id) continue;
        const list = claimFilesByDocType.get(f.document_type_id) ?? [];
        list.push({
          id: f.id,
          fileName: f.file_name,
          uploadedBy: f.uploaded_by,
          uploadedAt: f.uploaded_at,
        });
        claimFilesByDocType.set(f.document_type_id, list);
      }

      claimDocuments = docs.map((d) => ({
        documentTypeId: d.documentTypeId,
        name: d.name,
        isFulfilled: fulfilledMap.get(d.documentTypeId) ?? false,
        files: claimFilesByDocType.get(d.documentTypeId) ?? [],
        verification: verificationByDocType.get(d.documentTypeId) ?? null,
      }));
    }
  }

  // Budget AA untuk approver: sisa terkini + selisih jika campaign melebihi.
  // Berlaku di semua level approval (submitted→L1 sampai L4→final).
  const PENDING_APPROVAL_STATUSES: CampaignStatus[] = [
    "submitted",
    "approved_l1",
    "approved_l2",
    "approved_l3",
    "approved_l4",
  ];
  const isApproverRole = ["manager", "admin", "superadmin"].includes(userRole);
  let aaBudgetInfo: AABudgetInfo | null = null;

  if (
    isApproverRole &&
    campaign.action_approval_id &&
    PENDING_APPROVAL_STATUSES.includes(campaign.status)
  ) {
    // Admin client: total komitmen harus mencakup campaign semua user,
    // sedangkan RLS bisa membatasi visibilitas untuk role manager.
    const admin = createAdminClient();
    const [{ data: aa }, { data: aaCampaigns }] = await Promise.all([
      admin
        .from("action_approvals")
        .select("target_budget")
        .eq("id", campaign.action_approval_id)
        .single(),
      admin
        .from("campaigns")
        .select("id, requested_budget, status")
        .eq("action_approval_id", campaign.action_approval_id),
    ]);

    if (aa) {
      const remaining = computeAARemainingBudget(
        aa.target_budget ?? 0,
        (aaCampaigns ?? []) as {
          id: string;
          requested_budget: number | null;
          status: CampaignStatus;
        }[],
        campaign.id
      );
      const shortfall = campaign.requested_budget - remaining;
      aaBudgetInfo = {
        remaining,
        exceeded: shortfall > 0,
        shortfall: Math.max(shortfall, 0),
      };
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
    { data: distributors },
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
        supabase.from("action_approvals").select("id, name, brand_id, start_date, end_date, target_budget, master_budget:master_budgets(promotion_category_id)").order("name"),
        supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
        supabase.from("distributors").select("id, name").eq("is_active", true).order("name"),
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
      claimAmountVerification={claimAmountVerification}
      claimEvents={claimEvents}
      aaBudgetInfo={aaBudgetInfo}
      isEditable={isEditable}
      userRole={userRole}
      userId={user.id}
      departments={departments ?? []}
      brands={brands ?? []}
      regions={regions ?? []}
      channels={channels ?? []}
      categories={categories ?? []}
      actionApprovals={actionApprovals ?? []}
      vendors={vendors ?? []}
      distributors={distributors ?? []}
      masterBudgets={masterBudgets ?? []}
    />
  );
}

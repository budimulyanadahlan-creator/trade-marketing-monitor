import { notFound } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { computeAARemainingBudget } from "@/lib/campaign-status";
import {
  distributorCampaignAccess,
  isClaimHolderCandidate,
  type DistributorCampaignAccess,
} from "@/lib/distributor-campaign-guard";
import {
  isClaimDeadlinePassed,
  isClaimedChildStatus,
  isOpenChildClaimStatus,
  isSubmittedAfterDeadline,
  nationalBudgetSummary,
  type NationalBudgetSummary,
} from "@/lib/national-skp";
import { CampaignDetailClient } from "./campaign-detail-client";
import type { CampaignRow, CampaignFileRow, ApprovalHistoryRow, RealizationRow, DistributorReceiptRow, ClaimEventRow, ClaimItemStatus, UserRole, CampaignStatus, DistributorScope } from "@/types/database";

export type ClaimDocumentFile = {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploaderName: string | null;
  uploadedAt: string;
  // Phase 3 (Loop Revisi): true for the most recently uploaded file for this
  // checklist item — re-uploads never delete the old file, so multiple files
  // can pile up on one item and the UI needs to tell latest from stale.
  isLatest: boolean;
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

/** SKP induk nasional dari sebuah klaim turunan (SKP Nasional Fase 2). */
export type NationalParentInfo = {
  id: string;
  name: string;
  skp_number: string | null;
  reference_number: string | null;
  status: CampaignStatus;
  /** Batas klaim dan penutupan induk (Fase 7). */
  claim_deadline: string | null;
  national_closed_at: string | null;
};

/**
 * Batas klaim yang berlaku di halaman ini (Fase 7): milik SKP induk itu
 * sendiri, atau milik induknya bila halaman ini klaim turunan. `passed`
 * dihitung di server menurut tanggal WIB. Hanya pengingat.
 */
export type NationalClaimDeadlineInfo = { date: string; passed: boolean };

/** Klaim turunan milik akun yang login yang belum diajukan, pada sebuah induk. */
export type OpenChildClaimInfo = {
  id: string;
  skp_number: string | null;
  status: CampaignStatus;
};

/** Satu klaim turunan milik akun yang login, untuk daftar "Klaim Saya" di induk (Fase 3). */
export type MyChildClaimInfo = OpenChildClaimInfo & {
  claim_amount: number | null;
  created_at: string;
};

/**
 * Satu klaim turunan pada tabel "Klaim Turunan" di halaman induk (Fase 5).
 * Hanya dikirim ke role internal — distributor tidak melihat klaim akun lain.
 */
export type NationalChildClaimRow = {
  id: string;
  skp_number: string | null;
  status: CampaignStatus;
  claim_amount: number | null;
  actual_spent: number;
  distributorName: string | null;
  ownerName: string | null;
  regionName: string | null;
  /** Diajukan setelah batas klaim induk (Fase 7). */
  submittedLate: boolean;
};

type NationalChildRaw = {
  id: string;
  skp_number: string | null;
  status: CampaignStatus;
  claim_amount: number | null;
  actual_spent: number | null;
  claim_submitted_at: string | null;
  claim_owner_id: string | null;
  distributor: { name: string } | null;
  region: { name: string } | null;
};

type CampaignFileWithUploader = CampaignFileRow & {
  uploader: { full_name: string } | null;
};

type ApprovalHistoryWithActor =ApprovalHistoryRow & {
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
  distributor: { name: string; parent_distributor_id: string | null } | null;
};

type ClaimItemRow = {
  id: string;
  item_type: "document" | "amount";
  document_type_id: string | null;
  status: ClaimItemStatus;
  note: string | null;
  decided_at: string | null;
  actor: { full_name: string } | null;
};

type ClaimRequirementRow = {
  document_type_id: string;
  claim_document_types: { name: string; sort_order: number } | null;
};

type ChecklistRow = { document_type_id: string; is_fulfilled: boolean };

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

  // Batch 1: none of these depend on each other's data — only on `id`
  // (route param) and `user.id`, both already known — so they fire as one
  // round-trip instead of the six sequential ones this used to be
  // (plans/perf-skp-pages.md, Fase 1a). distributor_receipts is fetched
  // unconditionally here too: its RLS lets more staff roles (finance,
  // manager) read it than the app actually shows it to, so the showReceipts
  // gate below — not the fetch itself — still decides what reaches the
  // client, same as before.
  const [
    { data: userProfile },
    { data: campaignRaw },
    { data: filesRaw },
    { data: historyRaw },
    { data: realizationsRaw },
    { data: receiptsRaw },
    { data: claimEventsRaw },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("role, distributor_id, distributor_scope, region_id")
      .eq("id", user.id)
      .single(),
    supabase
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
        claim_holder:users!campaigns_claim_submitted_by_fkey(full_name)
      `
      )
      .eq("id", id)
      .single(),
    supabase
      .from("campaign_files")
      .select("*, uploader:uploaded_by(full_name)")
      .eq("campaign_id", id)
      .order("uploaded_at"),
    supabase
      .from("approval_history")
      .select("*, actor:users!approval_history_actor_id_fkey(full_name)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("realizations")
      .select("*, creator:created_by(full_name)")
      .eq("campaign_id", id)
      .order("realization_date", { ascending: true }),
    supabase
      .from("distributor_receipts")
      .select("*, receiver:received_by(full_name)")
      .eq("campaign_id", id)
      .order("received_at", { ascending: true }),
    // Riwayat ajukan/batalkan klaim — visible to whoever the RLS policy on
    // claim_events lets see this campaign's events (admin/superadmin/
    // finance/manager always, distributor for their own visible SKP).
    supabase
      .from("claim_events")
      .select(
        "*, actor:actor_id(full_name), from_user:from_user_id(full_name), to_user:to_user_id(full_name)"
      )
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const userRole = (userProfile?.role ?? "user") as UserRole;

  // RLS (distributor_campaign_access, migrasi 067) sudah menyembunyikan SKP
  // yang tidak boleh dilihat distributor — URL langsung berakhir "tidak
  // ditemukan". Di sini tinggal menentukan boleh bertindak atau hanya lihat
  // (Pusat perusahaan induk) agar tombol aksi disembunyikan di klien.
  if (!campaignRaw) notFound();
  const campaign = campaignRaw as unknown as CampaignWithJoins;

  const distributorAccess: DistributorCampaignAccess =
    userRole === "distributor"
      ? distributorCampaignAccess(
          {
            distributor_id: campaign.distributor_id ?? null,
            region_id: campaign.region_id ?? null,
            distributor_parent_id: campaign.distributor?.parent_distributor_id ?? null,
            is_national: campaign.is_national,
            parent_campaign_id: campaign.parent_campaign_id ?? null,
            claim_owner_id: campaign.claim_owner_id ?? null,
            status: campaign.status,
          },
          {
            id: user.id,
            role: userRole,
            distributor_id: userProfile?.distributor_id ?? null,
            distributor_scope: (userProfile?.distributor_scope ?? null) as DistributorScope | null,
            region_id: userProfile?.region_id ?? null,
          }
        )
      : "act";
  // Pertahanan lapis kedua: jika RLS belum menyaring (misalnya migrasi belum
  // jalan), distributor yang tidak berhak tetap mendapat "tidak ditemukan".
  if (userRole === "distributor" && distributorAccess === null) notFound();

  // ── SKP Nasional Fase 2: klaim turunan ────────────────────────────────
  // Turunan: tautan ke induk, No surat & lampiran surat induk, nama pemilik.
  // Induk (dibuka distributor): semua klaim turunannya sendiri (Fase 3) untuk
  // daftar "Klaim Saya"; yang belum diajukan menonaktifkan tombol "Buat Klaim"
  // dan ditautkan dari sana.
  const isNationalChild = !!campaign.parent_campaign_id;
  let nationalParent: NationalParentInfo | null = null;
  let nationalParentFiles: CampaignFileRow[] = [];
  let claimOwnerName: string | null = null;
  let myOpenChildClaim: OpenChildClaimInfo | null = null;
  let myChildClaims: MyChildClaimInfo[] = [];

  if (isNationalChild) {
    // RLS: distributor pemilik turunan melihat induknya (akses "view") dan
    // lampiran surat induk; role internal melihat sesuai aturan SKP biasa.
    const [{ data: parentRaw }, { data: parentFilesRaw }, { data: ownerRaw }] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, name, skp_number, reference_number, status, claim_deadline, national_closed_at")
        .eq("id", campaign.parent_campaign_id!)
        .maybeSingle(),
      supabase
        .from("campaign_files")
        .select("*")
        .eq("campaign_id", campaign.parent_campaign_id!)
        .is("document_type_id", null)
        .order("uploaded_at"),
      campaign.claim_owner_id
        ? supabase.from("users").select("full_name").eq("id", campaign.claim_owner_id).maybeSingle()
        : Promise.resolve({ data: null as { full_name: string } | null }),
    ]);
    nationalParent = (parentRaw ?? null) as NationalParentInfo | null;
    nationalParentFiles = (parentFilesRaw ?? []) as CampaignFileRow[];
    claimOwnerName = ownerRaw?.full_name ?? null;
  } else if (campaign.is_national && userRole === "distributor") {
    // RLS: hanya turunan milik akun ini yang terlihat, termasuk yang dibatalkan.
    const { data: myChildrenRaw } = await supabase
      .from("campaigns")
      .select("id, skp_number, status, claim_amount, created_at")
      .eq("parent_campaign_id", campaign.id)
      .eq("claim_owner_id", user.id)
      .order("child_seq", { ascending: true });
    myChildClaims = (myChildrenRaw ?? []) as MyChildClaimInfo[];
    myOpenChildClaim =
      [...myChildClaims].reverse().find((c) => isOpenChildClaimStatus(c.status)) ?? null;
  }

  // ── SKP Nasional Fase 5: pantauan budget ──────────────────────────────
  // Induk dibuka role internal: tabel semua klaim turunan + ringkasan budget.
  // Turunan dibuka Finance/admin saat nominalnya sudah diajukan: ringkasan
  // induknya, untuk peringatan kelebihan klaim di layar verifikasi.
  // Hak layanan: role internal yang boleh membuka induk (mis. ASM pembuatnya)
  // belum tentu punya akses RLS ke baris turunan, yang dibuat akun distributor.
  // Distributor tidak pernah menerima angka-angka ini.
  const isInternalRole = userRole !== "distributor";
  const canSeeOverClaimWarning = ["admin", "superadmin", "finance"].includes(userRole);
  let nationalChildClaims: NationalChildClaimRow[] = [];
  let nationalBudget: NationalBudgetSummary | null = null;

  if (campaign.is_national && isInternalRole) {
    const admin = createAdminClient();
    const { data: childrenRaw } = await admin
      .from("campaigns")
      .select(
        "id, skp_number, status, claim_amount, actual_spent, claim_submitted_at, claim_owner_id, distributor:distributors(name), region:regions(name)"
      )
      .eq("parent_campaign_id", campaign.id)
      .order("child_seq", { ascending: true });
    const children = (childrenRaw ?? []) as unknown as NationalChildRaw[];

    const ownerIds = [
      ...new Set(children.map((c) => c.claim_owner_id).filter((v): v is string => !!v)),
    ];
    const ownerNameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await admin.from("users").select("id, full_name").in("id", ownerIds);
      for (const o of owners ?? []) ownerNameById.set(o.id, o.full_name);
    }

    nationalChildClaims = children.map((c) => ({
      id: c.id,
      skp_number: c.skp_number,
      status: c.status,
      claim_amount: c.claim_amount,
      actual_spent: c.actual_spent ?? 0,
      distributorName: c.distributor?.name ?? null,
      ownerName: c.claim_owner_id ? (ownerNameById.get(c.claim_owner_id) ?? null) : null,
      regionName: c.region?.name ?? null,
      submittedLate:
        isClaimedChildStatus(c.status) &&
        isSubmittedAfterDeadline(campaign.claim_deadline, c.claim_submitted_at),
    }));
    nationalBudget = nationalBudgetSummary(campaign.requested_budget, children);
  } else if (isNationalChild && canSeeOverClaimWarning && isClaimedChildStatus(campaign.status)) {
    const admin = createAdminClient();
    const [{ data: parentBudgetRaw }, { data: siblingsRaw }] = await Promise.all([
      admin
        .from("campaigns")
        .select("requested_budget")
        .eq("id", campaign.parent_campaign_id!)
        .maybeSingle(),
      admin
        .from("campaigns")
        .select("status, claim_amount, actual_spent")
        .eq("parent_campaign_id", campaign.parent_campaign_id!),
    ]);
    if (parentBudgetRaw) {
      nationalBudget = nationalBudgetSummary(parentBudgetRaw.requested_budget, siblingsRaw ?? []);
    }
  }

  // ── SKP Nasional Fase 7: batas klaim ──────────────────────────────────
  // Induk: batas klaimnya sendiri. Turunan: batas klaim induknya, plus
  // keterangan "Diajukan setelah batas klaim" untuk Finance/admin. Pengingat
  // saja — tidak ada aksi yang ditolak karenanya.
  const deadlineDate = campaign.is_national
    ? (campaign.claim_deadline ?? null)
    : (nationalParent?.claim_deadline ?? null);
  const nationalClaimDeadline: NationalClaimDeadlineInfo | null = deadlineDate
    ? { date: deadlineDate, passed: isClaimDeadlinePassed(deadlineDate, new Date()) }
    : null;
  const claimSubmittedLate =
    isNationalChild &&
    isClaimedChildStatus(campaign.status) &&
    isSubmittedAfterDeadline(nationalParent?.claim_deadline, campaign.claim_submitted_at);

  // Distributor tidak melihat nilai terpakai SKP induk (gabungan realisasi
  // semua cabang) — angkanya tidak dikirim ke klien.
  if (campaign.is_national && !isInternalRole) {
    campaign.actual_spent = 0;
  }

  const files = (filesRaw ?? []) as CampaignFileRow[];
  const approvalHistory = (historyRaw ?? []) as unknown as ApprovalHistoryWithActor[];
  const realizations = (realizationsRaw ?? []) as (RealizationRow & {
    creator: { full_name: string } | null;
  })[];

  const showReceipts = ["distributor", "admin", "superadmin"].includes(userRole);
  const distributorReceipts = showReceipts
    ? ((receiptsRaw ?? []) as (DistributorReceiptRow & {
        receiver: { full_name: string } | null;
      })[])
    : [];

  const claimEvents = (claimEventsRaw ?? []) as unknown as (ClaimEventRow & {
    actor: { full_name: string } | null;
    from_user: { full_name: string } | null;
    to_user: { full_name: string } | null;
  })[];

  // Fase 10: kandidat pemegang klaim baru untuk tombol "Alihkan pemegang
  // klaim" — hanya admin/superadmin saat klaim diajukan. Hanya akun
  // distributor aktif dari perusahaan SKP itu (bukan induk), tanpa pemegang
  // saat ini; server action memeriksa ulang aturan yang sama.
  let claimHolderCandidates: { id: string; full_name: string }[] = [];
  if (
    (userRole === "admin" || userRole === "superadmin") &&
    campaign.status === "claim_submitted" &&
    campaign.distributor_id &&
    // Klaim turunan dikunci ke pemiliknya; alih kepemilikan menyusul (Fase 8).
    !isNationalChild
  ) {
    const { data: candidateUsers } = await supabase
      .from("users")
      .select("id, full_name, role, is_active, distributor_id")
      .eq("role", "distributor")
      .eq("distributor_id", campaign.distributor_id)
      .eq("is_active", true)
      .order("full_name");
    const claim = {
      status: campaign.status,
      claim_submitted_by: campaign.claim_submitted_by ?? null,
      distributor_id: campaign.distributor_id,
    };
    claimHolderCandidates = (candidateUsers ?? [])
      .filter((u) => isClaimHolderCandidate({ ...u, distributor_id: u.distributor_id ?? null }, claim))
      .map((u) => ({ id: u.id, full_name: u.full_name }));
  }

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

  // Batch 2: item verifications, claim requirements and the distributor's
  // checklist are all independent of each other (each only needs `id` and/or
  // campaign.promotion_category_id, both already known from Batch 1) — one
  // more round-trip instead of two sequential ones.
  const wantsItemVerifications = showClaimSection && ITEM_VERIFICATION_STATUSES.includes(campaign.status);
  // SKP induk nasional tidak punya checklist — checklist ada di klaim turunan.
  const wantsClaimRequirements =
    showClaimSection && !!campaign.promotion_category_id && !campaign.is_national;

  const [
    { data: itemsRaw },
    { data: requirementsRaw },
    { data: checklistsRaw },
  ] = await Promise.all([
    wantsItemVerifications
      ? supabase
          .from("claim_item_verifications")
          // Item rows are created when the claim is submitted
          // (submitKlaimAction, app/actions/realizations.ts). This page used
          // to also self-heal here on every load as a safety net for claims
          // that predated this feature — those have all been backfilled
          // (scripts/backfill-claim-item-verifications.js,
          // plans/perf-skp-pages.md Fase 0), so that per-load call was
          // removed.
          .select("id, item_type, document_type_id, status, note, decided_at, actor:actor_id(full_name)")
          .eq("campaign_id", id)
      : Promise.resolve({ data: [] as unknown as ClaimItemRow[] }),
    wantsClaimRequirements
      ? supabase
          .from("claim_requirements")
          .select("document_type_id, claim_document_types(name, sort_order)")
          .eq("promotion_category_id", campaign.promotion_category_id!)
      : Promise.resolve({ data: [] as unknown as ClaimRequirementRow[] }),
    wantsClaimRequirements
      ? supabase
          .from("distributor_claim_checklists")
          .select("document_type_id, is_fulfilled")
          .eq("campaign_id", id)
      : Promise.resolve({ data: [] as ChecklistRow[] }),
  ]);

  for (const row of (itemsRaw ?? []) as unknown as ClaimItemRow[]) {
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

    // Fase 8: checklist satu baris per SKP + jenis dokumen, sama untuk
    // distributor (semua akun perusahaan) dan Finance/admin.
    const fulfilledMap = new Map<string, boolean>();
    for (const row of checklistsRaw ?? []) {
      if (row.is_fulfilled) {
        fulfilledMap.set(row.document_type_id, true);
      } else if (!fulfilledMap.has(row.document_type_id)) {
        fulfilledMap.set(row.document_type_id, false);
      }
    }

    // Claim document files (document_type_id set) grouped per checklist item.
    // filesRaw is already ordered by uploaded_at, so the last entry pushed
    // per document type is the most recent one.
    const claimFilesByDocType = new Map<string, ClaimDocumentFile[]>();
    for (const f of (filesRaw ?? []) as unknown as CampaignFileWithUploader[]) {
      if (!f.document_type_id) continue;
      const list = claimFilesByDocType.get(f.document_type_id) ?? [];
      list.push({
        id: f.id,
        fileName: f.file_name,
        uploadedBy: f.uploaded_by,
        uploaderName: f.uploader?.full_name ?? null,
        uploadedAt: f.uploaded_at,
        isLatest: false, // corrected below once each list is complete
      });
      claimFilesByDocType.set(f.document_type_id, list);
    }
    for (const list of claimFilesByDocType.values()) {
      if (list.length > 0) list[list.length - 1].isLatest = true;
    }

    claimDocuments = docs.map((d) => ({
      documentTypeId: d.documentTypeId,
      name: d.name,
      isFulfilled: fulfilledMap.get(d.documentTypeId) ?? false,
      files: claimFilesByDocType.get(d.documentTypeId) ?? [],
      verification: verificationByDocType.get(d.documentTypeId) ?? null,
    }));
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
      claimHolderCandidates={claimHolderCandidates}
      aaBudgetInfo={aaBudgetInfo}
      isEditable={isEditable}
      userRole={userRole}
      userId={user.id}
      distributorAccess={distributorAccess}
      nationalParent={nationalParent}
      nationalParentFiles={nationalParentFiles}
      claimOwnerName={claimOwnerName}
      myOpenChildClaim={myOpenChildClaim}
      myChildClaims={myChildClaims}
      nationalChildClaims={nationalChildClaims}
      nationalBudget={nationalBudget}
      canSeeOverClaimWarning={canSeeOverClaimWarning}
      nationalClaimDeadline={nationalClaimDeadline}
      claimSubmittedLate={claimSubmittedLate}
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

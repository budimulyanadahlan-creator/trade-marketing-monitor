import { createClient, createAdminClient } from "@/lib/supabase/server";
import { activeChildClaimCountByParentId } from "@/lib/national-skp";
import { DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES } from "@/lib/campaign-status";
import { computeChecklistReadinessByCampaignId } from "@/lib/claim-checklist-status";
import { computeClaimVerificationProgressByCampaignId } from "@/lib/claim-verification-progress";
import { distributorCampaignAccess } from "@/lib/distributor-campaign-guard";
import { isCampaignWithoutDistributor } from "@/lib/campaign-distributor-required";
import {
  computeSpecialUploaderWorklist,
  sortBySpecialUploaderWorklist,
  specialUploaderWorklistLabel,
  type SpecialUploaderWorklistPriority,
} from "@/lib/claim-document-worklist";
import { fetchAppointedUploadersByDocType } from "@/lib/claim-document-uploaders-data";
import type { AppointedUploader } from "@/lib/claim-document-uploaders";
import { CampaignsClient } from "./campaigns-client";
import type { ClaimItemStatus, DistributorScope, UserRole } from "@/types/database";

/** `.in()` dengan ratusan UUID bisa melewati batas panjang URL — dipecah. */
const WORKLIST_ID_CHUNK = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ distributor?: string; menunggu?: string }>;
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
    // Klaim turunan SKP nasional yang dibatalkan tetap terlihat pemiliknya
    // (SKP Nasional Fase 3) — satu-satunya baris Dibatalkan di jendela RLS.
    campaignQuery = campaignQuery.or(
      `status.in.(${DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES.join(",")}),and(status.eq.cancelled,parent_campaign_id.not.is.null)`
    );
  } else if (!["finance", "admin", "superadmin"].includes(profile?.role ?? "")) {
    // ASM, manajer, dan role internal lain hanya melihat SKP induk nasional;
    // baris klaim turunan hanya untuk antrean Finance/admin (SKP Nasional
    // Fase 6). Rekap klaimnya tetap terbaca di halaman induk.
    campaignQuery = campaignQuery.is("parent_campaign_id", null);
  }

  const { data: campaigns } = await campaignQuery;

  // ── SKP Nasional Fase 5 ───────────────────────────────────────────────
  // Role internal: jumlah klaim turunan aktif per induk untuk lencana
  // "Nasional · N klaim". Hak layanan, karena role internal selain
  // Finance/admin belum tentu punya akses RLS ke baris turunan.
  // Distributor: nilai terpakai induk (gabungan realisasi semua cabang) tidak
  // dikirim ke klien.
  let nationalClaimCountByCampaignId: Record<string, number> = {};
  const nationalParentIds = (campaigns ?? []).filter((c) => c.is_national).map((c) => c.id);
  if (isDistributor) {
    for (const c of campaigns ?? []) {
      if (c.is_national) c.actual_spent = 0;
    }
  } else if (nationalParentIds.length > 0) {
    const { data: nationalChildren } = await createAdminClient()
      .from("campaigns")
      .select("parent_campaign_id, status")
      .in("parent_campaign_id", nationalParentIds);
    nationalClaimCountByCampaignId = activeChildClaimCountByParentId(nationalChildren ?? []);
  }

  // Filter khusus admin `?distributor=none` (Fase 5 multi-user distributor):
  // SKP Sales/TM berstatus Disetujui s.d. Selesai yang belum punya distributor,
  // yaitu SKP yang tidak terlihat oleh distributor mana pun.
  const { distributor: distributorParam, menunggu: worklistParam } = await searchParams;
  const isAdminOrSuperadmin = profile?.role === "admin" || profile?.role === "superadmin";
  const noDistributorOnly = isAdminOrSuperadmin && distributorParam === "none";
  const listedCampaigns = noDistributorOnly
    ? (campaigns ?? []).filter((c) =>
        isCampaignWithoutDistributor({
          distributor_id: c.distributor_id,
          status: c.status,
          departmentName: (c.department as { name?: string } | null)?.name,
          is_national: c.is_national,
        })
      )
    : (campaigns ?? []);

  // SKP yang hanya boleh dilihat (Pusat perusahaan induk melihat SKP anak
  // perusahaan, SKP induk nasional untuk semua akun, dan klaim turunan yang
  // dibatalkan): tombol aksi di daftar disembunyikan untuk ID ini.
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
          is_national: c.is_national,
          parent_campaign_id: c.parent_campaign_id ?? null,
          claim_owner_id: c.claim_owner_id ?? null,
          status: c.status,
        },
        { ...profile, id: user.id }
      );
      if (access === "view") readOnlyCampaignIds.push(c.id);
    }
  }

  // Klaim turunan SKP nasional (Fase 2): nama SKP induk dan akun pemilik
  // untuk ditampilkan di bawah nama baris turunan. Nama induk diambil dari
  // daftar yang sama (induk terlihat oleh siapa pun yang melihat turunannya);
  // nama pemilik untuk role internal dan untuk akun pusat distributor yang
  // memantau klaim akun lain (Fase 4, `viewOnly`) — pada klaim milik sendiri
  // nama pemilik tidak ditampilkan.
  const childClaimInfoByCampaignId: Record<
    string,
    { parentName: string | null; ownerName: string | null; viewOnly: boolean }
  > = {};
  const childClaims = (campaigns ?? []).filter((c) => c.parent_campaign_id);
  if (childClaims.length > 0) {
    const nameById = new Map((campaigns ?? []).map((c) => [c.id, c.name]));
    const ownerNameById = new Map<string, string>();
    {
      const ownerIds = [
        ...new Set(
          childClaims
            .map((c) => c.claim_owner_id)
            .filter((id): id is string => !!id && !(isDistributor && id === user.id))
        ),
      ];
      if (ownerIds.length > 0) {
        const { data: owners } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", ownerIds);
        for (const o of owners ?? []) ownerNameById.set(o.id, o.full_name);
      }
    }
    for (const c of childClaims) {
      childClaimInfoByCampaignId[c.id] = {
        parentName: nameById.get(c.parent_campaign_id!) ?? null,
        ownerName: c.claim_owner_id ? (ownerNameById.get(c.claim_owner_id) ?? null) : null,
        viewOnly: isDistributor && c.claim_owner_id !== user.id,
      };
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
    // Induk nasional tidak punya checklist (ada di klaim turunan), jadi tidak
    // pernah masuk hitungan maupun filter "Checklist Siap".
    const approvedCampaigns = (campaigns ?? []).filter(
      (c) => c.status === "approved" && !c.is_national
    );
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

  // ── Pengunggah Khusus Fase 7: daftar kerja ────────────────────────────
  // Hanya untuk akun yang ditunjuk sebagai pengunggah khusus minimal satu
  // jenis dokumen; akun lain berhenti setelah satu query penunjukan (tabel
  // kecil). Semuanya batch dari daftar SKP yang sudah diambil — tanpa query
  // per baris. Aturannya ada di lib/claim-document-worklist.ts.
  let worklistLabel: string | null = null;
  let worklistPriorityByCampaignId: Record<string, SpecialUploaderWorklistPriority> = {};
  if (isDistributor) {
    // Klien sistem: distributor tidak selalu boleh membaca baris akun lain.
    // Gagal baca hanya menyembunyikan filter.
    const appointedByDocType = await fetchAppointedUploadersByDocType(createAdminClient()).catch(
      () => new Map<string, AppointedUploader[]>()
    );
    const myAppointedByDocType = new Map(
      [...appointedByDocType].filter(([, list]) => list.some((a) => a.id === user.id))
    );
    const myDocTypeIds = [...myAppointedByDocType.keys()];

    if (myDocTypeIds.length > 0) {
      const candidates = (campaigns ?? []).filter(
        (c) =>
          ["approved", "ongoing", "claim_submitted"].includes(c.status) &&
          !c.is_national &&
          !!c.promotion_category_id
      );
      const candidateIds = candidates.map((c) => c.id);
      const submittedIds = candidates
        .filter((c) => c.status === "claim_submitted")
        .map((c) => c.id);
      const categoryIds = [...new Set(candidates.map((c) => c.promotion_category_id as string))];

      const [{ data: docTypes }, { data: requirements }, fileChunks, itemChunks] =
        await Promise.all([
          supabase.from("claim_document_types").select("id, name").in("id", myDocTypeIds),
          categoryIds.length > 0
            ? supabase
                .from("claim_requirements")
                .select("promotion_category_id, document_type_id")
                .in("promotion_category_id", categoryIds)
                .in("document_type_id", myDocTypeIds)
            : Promise.resolve({
                data: [] as { promotion_category_id: string; document_type_id: string }[],
              }),
          Promise.all(
            chunk(candidateIds, WORKLIST_ID_CHUNK).map((ids) =>
              supabase
                .from("campaign_files")
                .select("campaign_id, document_type_id")
                .in("campaign_id", ids)
                .in("document_type_id", myDocTypeIds)
            )
          ),
          Promise.all(
            chunk(submittedIds, WORKLIST_ID_CHUNK).map((ids) =>
              supabase
                .from("claim_item_verifications")
                .select("campaign_id, document_type_id, status")
                .in("campaign_id", ids)
                .in("document_type_id", myDocTypeIds)
            )
          ),
        ]);

      // Gagal membaca file / status item akan membuat SKP yang sudah beres
      // tampak menunggu — lebih baik filter tidak tampil daripada menyesatkan.
      const readFailed = fileChunks.some((r) => r.error) || itemChunks.some((r) => r.error);
      if (!readFailed) {
        worklistLabel = specialUploaderWorklistLabel(
          (docTypes ?? []).map((d) => d.name).filter(Boolean)
        );
        worklistPriorityByCampaignId = computeSpecialUploaderWorklist({
          actorId: user.id,
          campaigns: candidates.map((c) => ({
            id: c.id,
            status: c.status,
            is_national: c.is_national,
            parent_campaign_id: c.parent_campaign_id ?? null,
            distributor_id: c.distributor_id ?? null,
            distributor_parent_id:
              (c.distributor as { parent_distributor_id?: string | null } | null)
                ?.parent_distributor_id ?? null,
            promotion_category_id: c.promotion_category_id ?? null,
          })),
          appointedByDocType: myAppointedByDocType,
          requirements: requirements ?? [],
          files: fileChunks.flatMap((r) => r.data ?? []),
          itemVerifications: itemChunks.flatMap((r) => r.data ?? []),
        });
      }
    }
  }
  const worklistOnly = worklistLabel !== null && worklistParam === "dokumen";
  const displayedCampaigns = worklistOnly
    ? sortBySpecialUploaderWorklist(listedCampaigns, worklistPriorityByCampaignId)
    : listedCampaigns;

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
      campaigns={displayedCampaigns}
      worklistLabel={worklistLabel}
      worklistOnly={worklistOnly}
      worklistPriorityByCampaignId={worklistPriorityByCampaignId}
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
      childClaimInfoByCampaignId={childClaimInfoByCampaignId}
      nationalClaimCountByCampaignId={nationalClaimCountByCampaignId}
    />
  );
}

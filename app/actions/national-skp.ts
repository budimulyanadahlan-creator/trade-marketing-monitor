"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  NATIONAL_REGION_NAME,
  OPEN_CHILD_CLAIM_STATUSES,
  cancelChildClaimError,
  claimDeadlineError,
  closeNationalError,
  createChildClaimError,
  makeNationalError,
  reopenNationalError,
  unmakeNationalError,
} from "@/lib/national-skp";

type NationalResult = { error?: string; success?: boolean };

const STALE_MESSAGE = "SKP sudah berubah — muat ulang halaman lalu coba lagi";

async function requireActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, actor: null, error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (!profile?.is_active) return { supabase, actor: null, error: "Akun tidak aktif" };

  return { supabase, actor: { id: user.id, role: profile.role as string }, error: null };
}

/**
 * Jadikan Nasional (SKP Nasional, Fase 1).
 *
 * Admin/superadmin menandai SKP Disetujui sebagai SKP induk nasional: tanda
 * nasional aktif, distributor dikosongkan, region pindah ke National — SKP
 * langsung terlihat semua akun distributor. Syaratnya di makeNationalError
 * (lib/national-skp.ts); database memeriksa ulang lewat trigger migrasi 074.
 */
export async function makeNationalAction(campaignId: string): Promise<NationalResult> {
  try {
    const { supabase, actor, error: authError } = await requireActor();
    if (!actor) return { error: authError ?? "Unauthorized" };

    const { data: campaignRaw } = await supabase
      .from("campaigns")
      .select(
        "id, status, is_national, claim_amount, claim_submitted_by, department:departments(name)"
      )
      .eq("id", campaignId)
      .single();
    if (!campaignRaw) return { error: "SKP tidak ditemukan" };
    const campaign = campaignRaw as unknown as {
      id: string;
      status: string;
      is_national: boolean | null;
      claim_amount: number | null;
      claim_submitted_by: string | null;
      department: { name: string } | null;
    };

    // Aktivitas klaim yang sudah menempel pada SKP (hanya jumlahnya).
    const head = { count: "exact", head: true } as const;
    const [realizations, checklists, claimFiles, receipts, claimEvents] = await Promise.all([
      supabase.from("realizations").select("id", head).eq("campaign_id", campaignId),
      supabase
        .from("distributor_claim_checklists")
        .select("id", head)
        .eq("campaign_id", campaignId)
        .eq("is_fulfilled", true),
      supabase
        .from("campaign_files")
        .select("id", head)
        .eq("campaign_id", campaignId)
        .not("document_type_id", "is", null),
      supabase.from("distributor_receipts").select("id", head).eq("campaign_id", campaignId),
      supabase.from("claim_events").select("id", head).eq("campaign_id", campaignId),
    ]);
    const countError = [realizations, checklists, claimFiles, receipts, claimEvents].find(
      (r) => r.error
    )?.error;
    if (countError) return { error: countError.message };

    const ruleError = makeNationalError(
      actor,
      {
        status: campaign.status,
        is_national: campaign.is_national,
        departmentName: campaign.department?.name,
        claim_amount: campaign.claim_amount ?? null,
        claim_submitted_by: campaign.claim_submitted_by ?? null,
      },
      {
        realizations: realizations.count ?? 0,
        fulfilledChecklistItems: checklists.count ?? 0,
        claimDocuments: claimFiles.count ?? 0,
        receipts: receipts.count ?? 0,
        claimEvents: claimEvents.count ?? 0,
      }
    );
    if (ruleError) return { error: ruleError };

    const { data: region } = await supabase
      .from("regions")
      .select("id, name")
      .ilike("name", NATIONAL_REGION_NAME)
      .limit(1)
      .maybeSingle();
    if (!region) {
      return {
        error: `Region ${NATIONAL_REGION_NAME} tidak ditemukan di master data — tambahkan dulu sebelum menjadikan SKP nasional`,
      };
    }

    // Syarat status dan tanda diulang di WHERE agar perubahan bersamaan
    // (mis. Finance mencatat realisasi di detik yang sama) tidak tertimpa.
    const { data: updated, error } = await supabase
      .from("campaigns")
      .update({ is_national: true, distributor_id: null, region_id: region.id })
      .eq("id", campaignId)
      .eq("status", "approved")
      .eq("is_national", false)
      .select("id");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: STALE_MESSAGE };

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

/**
 * Batalkan Nasional (SKP Nasional, Fase 1).
 *
 * Mencabut tanda nasional selama belum ada klaim turunan. Distributor dan
 * region tidak dikembalikan — SKP menjadi SKP biasa tanpa distributor
 * (tersembunyi dari distributor) sampai admin mengisinya.
 */
export async function unmakeNationalAction(campaignId: string): Promise<NationalResult> {
  try {
    const { supabase, actor, error: authError } = await requireActor();
    if (!actor) return { error: authError ?? "Unauthorized" };

    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, is_national")
      .eq("id", campaignId)
      .single();
    if (!campaign) return { error: "SKP tidak ditemukan" };

    // Klaim turunan (status apa pun) mengunci tanda nasional; database
    // memeriksa ulang lewat trigger migrasi 075.
    const { count: childClaimCount, error: countError } = await supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("parent_campaign_id", campaignId);
    if (countError) return { error: countError.message };

    const ruleError = unmakeNationalError(actor, campaign, childClaimCount ?? 0);
    if (ruleError) return { error: ruleError };

    const { data: updated, error } = await supabase
      .from("campaigns")
      .update({ is_national: false })
      .eq("id", campaignId)
      .eq("is_national", true)
      .select("id");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: STALE_MESSAGE };

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// Buat Klaim (SKP Nasional, Fase 2)
// ============================================================

export type CreateChildClaimResult = { error?: string; success?: boolean; childId?: string };

const CHILD_CLAIM_FAILED = "Klaim gagal dibuat — coba lagi sebentar lagi";

/**
 * Buat Klaim: akun distributor membuat klaim turunan miliknya di bawah SKP
 * induk nasional. Turunan adalah baris SKP biasa (status Disetujui, nilai 0,
 * nomor induk + -K01, perusahaan & region dari akun) tempat seluruh alur
 * klaim yang ada berjalan.
 *
 * Syaratnya di createChildClaimError (lib/national-skp.ts). Baris ditulis
 * dengan hak layanan lewat fungsi database create_national_child_claim
 * (migrasi 075) — distributor tidak punya izin INSERT ke campaigns, dan
 * fungsi itu mengunci induk agar nomor urut dua akun yang menekan bersamaan
 * tidak kembar. Pemilik selalu akun yang login, tidak pernah dari input.
 */
export async function createChildClaimAction(parentId: string): Promise<CreateChildClaimResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };

    const { data: profile } = await supabase
      .from("users")
      .select("role, is_active, distributor_id")
      .eq("id", user.id)
      .single();
    if (!profile) return { error: "Unauthorized" };

    // Dibaca dengan sesi akun: RLS memastikan hanya induk yang memang
    // terlihat oleh akun ini (Disetujui s.d. Selesai, Sales/TM) yang lolos.
    const { data: parent } = await supabase
      .from("campaigns")
      .select("id, status, is_national, parent_campaign_id, skp_number, national_closed_at")
      .eq("id", parentId)
      .single();

    const actor = {
      role: profile.role as string,
      is_active: !!profile.is_active,
      distributor_id: (profile.distributor_id ?? null) as string | null,
    };
    // Aturan akun diperiksa sebelum "tidak ditemukan" agar pesannya tepat.
    const actorError = createChildClaimError(
      actor,
      { status: "approved", is_national: true, parent_campaign_id: null, skp_number: "-" },
      0
    );
    if (actorError) return { error: actorError };
    if (!parent) return { error: "SKP tidak ditemukan" };

    const { count: openClaims, error: countError } = await supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("parent_campaign_id", parentId)
      .eq("claim_owner_id", user.id)
      .in("status", [...OPEN_CHILD_CLAIM_STATUSES]);
    if (countError) return { error: countError.message };

    const ruleError = createChildClaimError(actor, parent, openClaims ?? 0);
    if (ruleError) return { error: ruleError };

    const { data: childId, error } = await createAdminClient().rpc("create_national_child_claim", {
      p_parent_id: parentId,
      p_owner_id: user.id,
    });

    if (error || !childId) {
      // P0001 = penolakan aturan dari fungsi database (pesannya sudah ramah,
      // mis. klaim kembar dari klik ganda). Selain itu error teknis.
      if (error?.code === "P0001" && error.message) return { error: error.message };
      console.error("[createChildClaimAction] rpc error:", error);
      return { error: CHILD_CLAIM_FAILED };
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${parentId}`);
    return { success: true, childId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// Batalkan Klaim (SKP Nasional, Fase 3)
// ============================================================

const CHILD_CANCEL_FAILED = "Klaim gagal dibatalkan — coba lagi sebentar lagi";

/**
 * Batalkan Klaim: pemilik (atau admin/superadmin) membatalkan klaim turunan
 * yang belum punya realisasi dan belum diajukan. Status menjadi Dibatalkan;
 * baris, dokumen, dan nomor urutnya tetap ada, dan akun itu boleh membuat
 * klaim baru atas SKP induk yang sama.
 *
 * Syaratnya di cancelChildClaimError (lib/national-skp.ts). Status ditulis
 * dengan hak layanan lewat fungsi database cancel_national_child_claim
 * (migrasi 076) — distributor tidak punya izin mengubah status SKP ke
 * Dibatalkan, dan fungsi itu mengunci baris klaim agar tidak berpapasan
 * dengan Finance yang sedang mencatat realisasi. Pelaku selalu akun yang
 * login, tidak pernah dari input.
 */
export async function cancelChildClaimAction(childId: string): Promise<NationalResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Unauthorized" };

    const { data: profile } = await supabase
      .from("users")
      .select("role, is_active")
      .eq("id", user.id)
      .single();
    if (!profile) return { error: "Unauthorized" };

    // Dibaca dengan sesi akun: RLS memastikan distributor hanya menemukan
    // klaim turunannya sendiri.
    const { data: child } = await supabase
      .from("campaigns")
      .select("id, status, parent_campaign_id, claim_owner_id")
      .eq("id", childId)
      .single();

    const actor = { id: user.id, role: profile.role as string, is_active: !!profile.is_active };
    if (!actor.is_active) return { error: "Akun tidak aktif" };
    if (!child) return { error: "Klaim tidak ditemukan" };

    const { count: realizationCount, error: countError } = await supabase
      .from("realizations")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", childId);
    if (countError) return { error: countError.message };

    const ruleError = cancelChildClaimError(actor, child, realizationCount ?? 0);
    if (ruleError) return { error: ruleError };

    const { error } = await createAdminClient().rpc("cancel_national_child_claim", {
      p_child_id: childId,
      p_actor_id: user.id,
    });

    if (error) {
      // P0001 = penolakan aturan dari fungsi database (pesannya sudah ramah,
      // mis. Finance baru saja mencatat realisasi). Selain itu error teknis.
      if (error.code === "P0001" && error.message) return { error: error.message };
      console.error("[cancelChildClaimAction] rpc error:", error);
      return { error: CHILD_CANCEL_FAILED };
    }

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${childId}`);
    if (child.parent_campaign_id) revalidatePath(`/campaigns/${child.parent_campaign_id}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// Batas klaim, tutup, dan buka kembali (SKP Nasional, Fase 7)
// ============================================================

type NationalParentState = {
  id: string;
  status: string;
  is_national: boolean | null;
  parent_campaign_id: string | null;
  national_closed_at: string | null;
};

async function readNationalParentState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string
): Promise<NationalParentState | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("id, status, is_national, parent_campaign_id, national_closed_at")
    .eq("id", campaignId)
    .single();
  return (data ?? null) as NationalParentState | null;
}

/**
 * Batas klaim: admin/superadmin mengisi, mengubah, atau mengosongkan (string
 * kosong / null) tenggat penagihan SKP induk. Hanya pengingat — tidak pernah
 * menolak pembuatan atau pengajuan klaim. Syaratnya di claimDeadlineError;
 * database memeriksa ulang lewat trigger migrasi 080.
 */
export async function setClaimDeadlineAction(
  campaignId: string,
  deadline: string | null
): Promise<NationalResult> {
  try {
    const { supabase, actor, error: authError } = await requireActor();
    if (!actor) return { error: authError ?? "Unauthorized" };

    const campaign = await readNationalParentState(supabase, campaignId);
    if (!campaign) return { error: "SKP tidak ditemukan" };

    const value = deadline && deadline.trim() !== "" ? deadline.trim() : null;
    const ruleError = claimDeadlineError(actor, campaign, value);
    if (ruleError) return { error: ruleError };

    const { data: updated, error } = await supabase
      .from("campaigns")
      .update({ claim_deadline: value })
      .eq("id", campaignId)
      .eq("is_national", true)
      .select("id");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: STALE_MESSAGE };

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

export type CloseNationalResult = NationalResult & {
  /** true = induk langsung berstatus Selesai (tidak ada klaim turunan yang berjalan). */
  completed?: boolean;
};

/**
 * Tutup SKP Nasional: tidak ada klaim turunan baru; klaim yang sedang
 * berjalan tetap diproses. Trigger migrasi 080 mencatat waktu & pelaku dan
 * menjadikan induk Selesai — langsung bila tidak ada turunan yang berjalan,
 * atau nanti saat turunan terakhir Selesai/Dibatalkan. Syaratnya di
 * closeNationalError.
 */
export async function closeNationalAction(campaignId: string): Promise<CloseNationalResult> {
  try {
    const { supabase, actor, error: authError } = await requireActor();
    if (!actor) return { error: authError ?? "Unauthorized" };

    const campaign = await readNationalParentState(supabase, campaignId);
    if (!campaign) return { error: "SKP tidak ditemukan" };

    const ruleError = closeNationalError(actor, campaign);
    if (ruleError) return { error: ruleError };

    // Syarat diulang di WHERE agar penutupan ganda / perubahan status
    // bersamaan tidak tertimpa.
    const { data: updated, error } = await supabase
      .from("campaigns")
      .update({ national_closed_at: new Date().toISOString(), national_closed_by: actor.id })
      .eq("id", campaignId)
      .eq("is_national", true)
      .eq("status", "approved")
      .is("national_closed_at", null)
      .select("id, status");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: STALE_MESSAGE };

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true, completed: updated[0].status === "completed" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

/**
 * Buka Kembali: induk yang sudah ditutup menerima klaim turunan lagi, selama
 * belum berstatus Selesai. Syaratnya di reopenNationalError.
 */
export async function reopenNationalAction(campaignId: string): Promise<NationalResult> {
  try {
    const { supabase, actor, error: authError } = await requireActor();
    if (!actor) return { error: authError ?? "Unauthorized" };

    const campaign = await readNationalParentState(supabase, campaignId);
    if (!campaign) return { error: "SKP tidak ditemukan" };

    const ruleError = reopenNationalError(actor, campaign);
    if (ruleError) return { error: ruleError };

    // Induk bisa menjadi Selesai di detik yang sama (turunan terakhir
    // diselesaikan Finance) — WHERE menolak pembukaan yang terlambat.
    const { data: updated, error } = await supabase
      .from("campaigns")
      .update({ national_closed_at: null, national_closed_by: null })
      .eq("id", campaignId)
      .eq("is_national", true)
      .neq("status", "completed")
      .not("national_closed_at", "is", null)
      .select("id");

    if (error) return { error: error.message };
    if (!updated || updated.length === 0) return { error: STALE_MESSAGE };

    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

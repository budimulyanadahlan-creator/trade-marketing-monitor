"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  NATIONAL_REGION_NAME,
  makeNationalError,
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

    // Klaim turunan baru ada mulai Fase 2 (kolom parent_campaign_id); sampai
    // saat itu jumlahnya selalu 0.
    const childClaimCount = 0;

    const ruleError = unmakeNationalError(actor, campaign, childClaimCount);
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

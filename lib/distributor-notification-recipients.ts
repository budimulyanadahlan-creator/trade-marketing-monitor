/**
 * Penerima email distributor (Multi-User Distributor, Fase 11).
 *
 * Satu sumber kebenaran untuk "siapa yang dikirimi email tentang SKP ini",
 * menggantikan query "semua distributor aktif di perusahaan" di aksi
 * verifikasi, realisasi, dan pengalihan pemegang klaim.
 *
 * - **Setelah klaim diajukan** (revisi diminta, disetujui, dibayar,
 *   pengalihan pemegang): pemegang klaim + akun Pusat perusahaan SKP + akun
 *   Pusat perusahaan induknya. Klaim tanpa pemegang tercatat (data lama)
 *   memakai aturan sebelum klaim agar tidak ada yang terlewat.
 * - **Sebelum klaim diajukan**: akun Cabang perusahaan SKP di region SKP +
 *   akun Pusat perusahaan SKP + akun Pusat induk.
 *
 * Akun nonaktif dan non-distributor tidak pernah menjadi penerima. Scope null
 * (akun lama) diperlakukan sebagai Cabang, sama seperti modul akses.
 */

import type { DistributorScope } from "@/types/database";
import type { createAdminClient } from "@/lib/supabase/server";

export type NotificationStage = "before_claim" | "after_claim";

export type NotificationCandidate = {
  id: string;
  role: string;
  is_active: boolean;
  distributor_id: string | null;
  distributor_scope: DistributorScope | null;
  region_id: string | null;
};

export type NotificationCampaign = {
  distributor_id: string | null;
  /** `distributors.parent_distributor_id` perusahaan SKP. */
  distributor_parent_id: string | null;
  region_id: string | null;
  /** Pemegang klaim. */
  claim_submitted_by: string | null;
};

/** Murni: id penerima tanpa duplikat, urut sesuai daftar kandidat. */
export function resolveDistributorRecipientIds(
  campaign: NotificationCampaign,
  candidates: NotificationCandidate[],
  stage: NotificationStage
): string[] {
  const company = campaign.distributor_id;
  if (!company) return [];
  const parent = campaign.distributor_parent_id;

  const eligible = candidates.filter((c) => c.role === "distributor" && c.is_active);

  const isPusatOf = (c: NotificationCandidate, companyId: string | null) =>
    !!companyId && c.distributor_id === companyId && c.distributor_scope === "pusat";

  const isCabangInRegion = (c: NotificationCandidate) =>
    c.distributor_id === company &&
    c.distributor_scope !== "pusat" &&
    !!campaign.region_id &&
    c.region_id === campaign.region_id;

  const holder = campaign.claim_submitted_by;
  const useHolder = stage === "after_claim" && !!holder;

  const ids = new Set<string>();
  for (const c of eligible) {
    const include =
      isPusatOf(c, company) ||
      isPusatOf(c, parent) ||
      (useHolder ? c.id === holder && c.distributor_id === company : isCabangInRegion(c));
    if (include) ids.add(c.id);
  }
  return [...ids];
}

type AdminClient = ReturnType<typeof createAdminClient>;

export type EmailRecipient = { id: string; email: string; name: string };

/**
 * Ambil SKP + kandidat dari database, lalu kembalikan alamat email penerima.
 * `holderOverride` dipakai saat pemegang baru belum tentu terbaca dari SKP
 * (misalnya tepat setelah pengalihan).
 */
export async function getDistributorNotificationRecipients(
  adminClient: AdminClient,
  campaignId: string,
  stage: NotificationStage,
  opts: { holderOverride?: string | null } = {}
): Promise<EmailRecipient[]> {
  const { data: campaign } = await adminClient
    .from("campaigns")
    .select("distributor_id, region_id, claim_submitted_by, distributor:distributors(parent_distributor_id)")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign?.distributor_id) return [];

  const distributor = campaign.distributor as { parent_distributor_id?: string | null } | null;
  const target: NotificationCampaign = {
    distributor_id: campaign.distributor_id,
    distributor_parent_id: distributor?.parent_distributor_id ?? null,
    region_id: campaign.region_id ?? null,
    claim_submitted_by:
      opts.holderOverride !== undefined ? opts.holderOverride : (campaign.claim_submitted_by ?? null),
  };

  const companyIds = [target.distributor_id, target.distributor_parent_id].filter(
    (id): id is string => !!id
  );
  const { data: users } = await adminClient
    .from("users")
    .select("id, full_name, role, is_active, distributor_id, distributor_scope, region_id")
    .eq("role", "distributor")
    .eq("is_active", true)
    .in("distributor_id", companyIds);
  if (!users || users.length === 0) return [];

  const recipientIds = new Set(
    resolveDistributorRecipientIds(target, users as NotificationCandidate[], stage)
  );
  if (recipientIds.size === 0) return [];

  const nameById = new Map(users.map((u) => [u.id, u.full_name as string]));
  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  return (authData?.users ?? [])
    .filter((u) => recipientIds.has(u.id) && u.email)
    .map((u) => ({ id: u.id, email: u.email!, name: nameById.get(u.id) ?? u.email! }));
}

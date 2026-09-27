import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CampaignRef = { campaign_skp: string | null; campaign_name: string | null };

/**
 * Tempelkan nomor & nama SKP ke mutasi yang tertaut. Lewat fungsi database
 * posm_campaign_refs (migrasi 045) karena RLS campaigns tidak mengizinkan
 * semua pembaca POSM melihat SKP yang ditautkan. Mutasi gimmick memakai
 * gimmick_campaign_refs (migrasi 052), yang hanya untuk can_manage_posm().
 */
export async function withCampaignRefs<T extends { campaign_id: string | null }>(
  supabase: Supabase,
  rows: T[],
  rpc: "posm_campaign_refs" | "gimmick_campaign_refs" = "posm_campaign_refs"
): Promise<(T & CampaignRef)[]> {
  const ids = [...new Set(rows.map((r) => r.campaign_id).filter((id): id is string => id !== null))];
  const { data } = ids.length
    ? await supabase.rpc(rpc, { p_ids: ids })
    : { data: [] };
  const byId = new Map((data ?? []).map((c) => [c.id, c]));

  return rows.map((r) => {
    const c = r.campaign_id ? byId.get(r.campaign_id) : undefined;
    return { ...r, campaign_skp: c?.skp_number ?? null, campaign_name: c?.name ?? null };
  });
}

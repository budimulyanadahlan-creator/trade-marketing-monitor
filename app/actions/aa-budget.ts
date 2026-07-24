"use server";

import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { COMMITTED_CAMPAIGN_STATUSES } from "@/lib/campaign-status";

const checkSchema = z.object({
  action_approval_id: z.string().uuid(),
  requested_budget: z.number().min(0),
  campaign_id: z.string().uuid().optional().nullable(),
});

// Respons sengaja hanya boolean: angka sisa budget AA tidak boleh bocor ke
// pengaju lewat network response. Angka sisa hanya dirender untuk approver
// (halaman detail campaign) dan admin (tabel AA).
export type CheckAABudgetResult = { exceeded: boolean };

export async function checkAABudgetExceededAction(
  input: z.infer<typeof checkSchema>
): Promise<CheckAABudgetResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { exceeded: false };

    const parsed = checkSchema.safeParse(input);
    if (!parsed.success) return { exceeded: false };
    const { action_approval_id, requested_budget, campaign_id } = parsed.data;

    // Admin client: RLS membatasi pengaju hanya melihat campaign miliknya,
    // padahal total komitmen harus mencakup campaign semua user.
    const admin = createAdminClient();

    const { data: aa } = await admin
      .from("action_approvals")
      .select("target_budget")
      .eq("id", action_approval_id)
      .single();
    if (!aa) return { exceeded: false };

    let query = admin
      .from("campaigns")
      .select("requested_budget")
      .eq("action_approval_id", action_approval_id)
      .in("status", [...COMMITTED_CAMPAIGN_STATUSES]);
    // Edge case edit: campaign yang sudah berstatus komitmen tidak boleh
    // dihitung ganda terhadap dirinya sendiri.
    if (campaign_id) query = query.neq("id", campaign_id);
    const { data: campaigns } = await query;

    const committedTotal = (campaigns ?? []).reduce(
      (sum, c) => sum + (c.requested_budget ?? 0),
      0
    );

    return { exceeded: requested_budget > (aa.target_budget ?? 0) - committedTotal };
  } catch {
    return { exceeded: false };
  }
}

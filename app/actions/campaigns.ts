"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { CampaignStatus } from "@/types/database";
import { sendSkpSubmittedEmail } from "@/lib/email";

async function requireActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, department_id, region_id")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) {
    throw new Error("Akun tidak aktif");
  }

  return { supabase, userId: user.id, profile };
}

// ============================================================
// SAVE DRAFT
// ============================================================

const draftSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, "Nama campaign harus diisi"),
  department_id: z.string().uuid("Department harus dipilih"),
  brand_id: z.string().uuid("Brand harus dipilih"),
  region_id: z.string().uuid("Region harus dipilih"),
  channel_id: z.string().uuid().optional().nullable(),
  promotion_category_id: z.string().uuid().optional().nullable(),
  action_approval_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  store_id: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  mechanism: z.string().optional().nullable(),
  avg_sales_3months: z.coerce.number().min(0).optional(),
  requested_budget: z.coerce.number().min(0).optional(),
  sales_projection: z.coerce.number().min(0).optional(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
});

export type SaveDraftResult = { error?: string; campaignId?: string };

export async function saveDraftCampaignAction(
  data: z.infer<typeof draftSchema>
): Promise<SaveDraftResult> {
  try {
    const { supabase, userId } = await requireActiveUser();

    const parsed = draftSchema.safeParse(data);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...fields } = parsed.data;

    const payload = {
      name: fields.name,
      department_id: fields.department_id,
      brand_id: fields.brand_id,
      region_id: fields.region_id,
      channel_id: fields.channel_id ?? null,
      promotion_category_id: fields.promotion_category_id ?? null,
      action_approval_id: fields.action_approval_id ?? null,
      vendor_id: fields.vendor_id ?? null,
      store_id: fields.store_id?.trim() || null,
      objective: fields.objective ?? null,
      mechanism: fields.mechanism ?? "",
      avg_sales_3months: fields.avg_sales_3months ?? 0,
      requested_budget: fields.requested_budget ?? 0,
      sales_projection: fields.sales_projection ?? 0,
      start_date: fields.start_date ?? null,
      end_date: fields.end_date ?? null,
      status: "draft" as CampaignStatus,
    };

    if (id) {
      const { error } = await supabase
        .from("campaigns")
        .update(payload)
        .eq("id", id)
        .eq("created_by", userId);
      if (error) return { error: error.message };
      revalidatePath("/campaigns");
      return { campaignId: id };
    } else {
      const { data: created, error } = await supabase
        .from("campaigns")
        .insert({ ...payload, created_by: userId })
        .select("id")
        .single();
      if (error) return { error: error.message };
      revalidatePath("/campaigns");
      return { campaignId: created.id };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// SUBMIT
// ============================================================

const submitSchema = z.object({
  id: z.string().uuid("ID campaign tidak valid"),
  name: z.string().min(1, "Nama campaign harus diisi"),
  department_id: z.string().uuid("Department harus dipilih"),
  brand_id: z.string().uuid("Brand harus dipilih"),
  region_id: z.string().uuid("Region harus dipilih"),
  channel_id: z.string().uuid("Channel harus dipilih"),
  promotion_category_id: z.string().uuid("Kategori promosi harus dipilih"),
  action_approval_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  store_id: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  mechanism: z.string().min(1, "Mekanisme harus diisi"),
  avg_sales_3months: z.coerce.number().min(1, "Rata-rata penjualan 3 bulan terakhir harus diisi"),
  requested_budget: z.coerce
    .number()
    .min(1, "Budget harus lebih dari 0"),
  sales_projection: z.coerce.number().min(0).optional().default(0),
  start_date: z.string().min(1, "Tanggal mulai harus diisi"),
  end_date: z.string().min(1, "Tanggal selesai harus diisi"),
});

export type SubmitCampaignResult = { error?: string; success?: boolean };

export async function submitCampaignAction(
  data: z.infer<typeof submitSchema>
): Promise<SubmitCampaignResult> {
  try {
    const { supabase, userId, profile } = await requireActiveUser();

    const parsed = submitSchema.safeParse(data);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
    }

    const { id, ...fields } = parsed.data;

    // Validate that at least one file has been uploaded for this campaign
    const { count: fileCount, error: fileCountError } = await supabase
      .from("campaign_files")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id);

    if (fileCountError) return { error: fileCountError.message };
    if ((fileCount ?? 0) === 0) {
      return { error: "Minimal 1 dokumen SKP harus diupload sebelum mengajukan" };
    }

    // Server-side region lock for Sales Dept users
    if (profile.role === "user" && profile.region_id && profile.department_id) {
      const { data: dept } = await supabase
        .from("departments")
        .select("name")
        .eq("id", profile.department_id)
        .single();
      if (dept?.name?.toLowerCase() === "sales" && fields.region_id !== profile.region_id) {
        return { error: "Region tidak sesuai dengan region yang di-assign ke akun Anda" };
      }
    }

    const { error } = await supabase
      .from("campaigns")
      .update({
        name: fields.name,
        department_id: fields.department_id,
        brand_id: fields.brand_id,
        region_id: fields.region_id,
        channel_id: fields.channel_id,
        promotion_category_id: fields.promotion_category_id,
        action_approval_id: fields.action_approval_id ?? null,
        vendor_id: fields.vendor_id ?? null,
        store_id: fields.store_id?.trim() || null,
        objective: fields.objective ?? null,
        mechanism: fields.mechanism,
        avg_sales_3months: fields.avg_sales_3months,
        requested_budget: fields.requested_budget,
        sales_projection: fields.sales_projection ?? 0,
        start_date: fields.start_date,
        end_date: fields.end_date,
        status: "submitted" as CampaignStatus,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("created_by", userId);

    if (error) return { error: error.message };

    await supabase.from("approval_history").insert({
      campaign_id: id,
      actor_id: userId,
      role: profile.role,
      action: "submitted",
      signature_text: null,
      comment: null,
    });

    revalidatePath("/campaigns");

    // Send email notifications to all active admin/superadmin users
    try {
      const adminClient = createAdminClient();

      const { data: submitterProfile } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", userId)
        .single();

      const { data: adminUsers } = await adminClient
        .from("users")
        .select("id, full_name")
        .in("role", ["admin", "superadmin"])
        .eq("is_active", true);

      if (adminUsers && adminUsers.length > 0) {
        const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const adminIdSet = new Set(adminUsers.map((u) => u.id));
        const nameById = Object.fromEntries(adminUsers.map((u) => [u.id, u.full_name]));

        const recipients = (authData?.users ?? [])
          .filter((u) => adminIdSet.has(u.id) && u.email)
          .map((u) => ({ email: u.email!, name: nameById[u.id] ?? u.email! }));

        if (recipients.length > 0) {
          const now = new Date().toISOString();
          await sendSkpSubmittedEmail({
            to: recipients,
            campaignName: parsed.data.name,
            campaignId: id,
            submitterName: submitterProfile?.full_name ?? "User",
            submittedAt: now,
          });
        }
      }
    } catch (emailErr) {
      console.error("[submitCampaignAction] Email notification error:", emailErr);
    }

    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// DISTRIBUTOR RECEIPT (CHECKLIST DITERIMA)
// ============================================================

export type CreateDistributorReceiptResult = { error?: string; success?: boolean };

export async function createDistributorReceiptAction(
  campaignId: string,
  notes: string | null
): Promise<CreateDistributorReceiptResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabase
      .from("users")
      .select("role, is_active, region_id")
      .eq("id", user.id)
      .single();

    if (!profile?.is_active || profile.role !== "distributor") {
      return { error: "Hanya Distributor yang dapat melakukan checklist penerimaan" };
    }

    const { error } = await supabase
      .from("distributor_receipts")
      .insert({
        campaign_id: campaignId,
        received_by: user.id,
        notes: notes?.trim() || null,
      });

    if (error) {
      if (error.code === "23505") return { error: "SKP ini sudah pernah di-checklist" };
      return { error: error.message };
    }

    revalidatePath("/campaigns");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// DELETE DRAFT
// ============================================================

export async function deleteDraftCampaignAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase, userId } = await requireActiveUser();

    const { error } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", id)
      .eq("created_by", userId)
      .eq("status", "draft");

    if (error) return { error: error.message };
    revalidatePath("/campaigns");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

// ============================================================
// DELETE BY ADMIN / SUPERADMIN
// ============================================================

const ADMIN_DELETABLE_STATUSES: CampaignStatus[] = ["draft", "rejected"];

export async function deleteCampaignAdminAction(
  id: string
): Promise<{ error?: string }> {
  try {
    const { supabase, profile } = await requireActiveUser();

    if (!["admin", "superadmin"].includes(profile.role)) {
      return { error: "Tidak memiliki izin untuk menghapus SKP" };
    }

    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("status, name")
      .eq("id", id)
      .single();

    if (fetchError || !campaign) return { error: "SKP tidak ditemukan" };

    if (
      profile.role === "admin" &&
      !ADMIN_DELETABLE_STATUSES.includes(campaign.status as CampaignStatus)
    ) {
      return { error: "Admin hanya dapat menghapus SKP berstatus Draft atau Ditolak" };
    }

    const { error } = await supabase.from("campaigns").delete().eq("id", id);
    if (error) return { error: error.message };

    revalidatePath("/campaigns");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Terjadi kesalahan" };
  }
}

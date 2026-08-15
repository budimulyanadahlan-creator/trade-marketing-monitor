import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { compressImageIfNeeded } from "@/lib/image-compress";
import { markChecklistFulfilled } from "@/lib/claim-checklist-sync";
import type { CampaignStatus } from "@/types/database";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB, applies to size after compression
// "claim_submitted" is intentionally excluded — once a claim is submitted,
// new uploads are locked until it's cancelled (Phase 3) or paid.
const EDITABLE_STATUSES: CampaignStatus[] = ["approved", "ongoing"];

// Upload a claim document for one checklist item. Distributor-only —
// mirrors CHECKLIST_EDITABLE_STATUSES in app/actions/claim-checklist.ts.
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) {
    return NextResponse.json({ error: "Akun tidak aktif" }, { status: 403 });
  }
  if (profile.role !== "distributor") {
    return NextResponse.json(
      { error: "Hanya distributor yang dapat mengupload dokumen klaim" },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const campaignId = formData.get("campaign_id") as string | null;
  const documentTypeId = formData.get("document_type_id") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID diperlukan" }, { status: 400 });
  }
  if (!documentTypeId) {
    return NextResponse.json({ error: "Jenis dokumen klaim diperlukan" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format file tidak didukung. Gunakan PDF, JPG, atau PNG." },
      { status: 400 }
    );
  }

  // RLS (campaigns_select_distributor) gates this to campaigns the
  // distributor is allowed to see at all; status is checked explicitly
  // below since the select policy also allows paid/completed for viewing.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    return NextResponse.json(
      { error: "SKP tidak ditemukan atau Anda tidak memiliki akses." },
      { status: 403 }
    );
  }

  if (!EDITABLE_STATUSES.includes(campaign.status as CampaignStatus)) {
    return NextResponse.json(
      {
        error: "Dokumen klaim hanya dapat diupload saat SKP berstatus Approved atau Ongoing",
      },
      { status: 400 }
    );
  }

  const { data: docType } = await supabase
    .from("claim_document_types")
    .select("id")
    .eq("id", documentTypeId)
    .single();

  if (!docType) {
    return NextResponse.json({ error: "Jenis dokumen klaim tidak ditemukan" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const originalBuffer = Buffer.from(arrayBuffer);

  let processed;
  try {
    processed = await compressImageIfNeeded(originalBuffer, file.type);
  } catch {
    return NextResponse.json({ error: "Gagal memproses gambar" }, { status: 500 });
  }

  if (processed.buffer.length > MAX_SIZE) {
    return NextResponse.json({ error: "Ukuran file maksimal 5 MB." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  // Re-encoded images always land on disk as .jpg, regardless of original extension.
  const storageFileName =
    processed.contentType === "image/jpeg" && file.type !== "image/jpeg"
      ? safeFileName.replace(/\.[^.]+$/, "") + ".jpg"
      : safeFileName;
  const storagePath = `${campaignId}/claim/${documentTypeId}/${Date.now()}-${storageFileName}`;

  const { error: uploadError } = await adminClient.storage
    .from("campaign-documents")
    .upload(storagePath, processed.buffer, {
      contentType: processed.contentType,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: fileRecord, error: dbError } = await supabase
    .from("campaign_files")
    .insert({
      campaign_id: campaignId,
      file_name: file.name,
      file_url: storagePath,
      file_type: processed.contentType,
      file_size: processed.buffer.length,
      uploaded_by: user.id,
      document_type_id: documentTypeId,
    })
    .select()
    .single();

  if (dbError) {
    // Clean up the uploaded file if DB insert fails
    await adminClient.storage.from("campaign-documents").remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Auto-check the checklist item. Best-effort: the file itself is already
  // saved, so a checklist sync failure shouldn't fail the whole upload.
  await markChecklistFulfilled(supabase, {
    campaignId,
    distributorId: user.id,
    documentTypeId,
  });

  return NextResponse.json({ file: fileRecord });
}

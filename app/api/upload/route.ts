import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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
    .select("is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) {
    return NextResponse.json({ error: "Akun tidak aktif" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const campaignId = formData.get("campaign_id") as string | null;

  if (!file) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (!campaignId) {
    return NextResponse.json({ error: "Campaign ID diperlukan" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format file tidak didukung. Gunakan PDF, JPG, atau PNG." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Ukuran file maksimal 5 MB." },
      { status: 400 }
    );
  }

  // Verify the campaign belongs to this user
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaignId)
    .eq("created_by", user.id)
    .single();

  if (!campaign) {
    return NextResponse.json(
      { error: "Campaign tidak ditemukan atau bukan milik Anda." },
      { status: 403 }
    );
  }

  const adminClient = createAdminClient();
  const safeFileName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
  const storagePath = `${user.id}/${campaignId}/${Date.now()}-${safeFileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await adminClient.storage
    .from("campaign-documents")
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Record file metadata
  const { data: fileRecord, error: dbError } = await supabase
    .from("campaign_files")
    .insert({
      campaign_id: campaignId,
      file_name: file.name,
      file_url: storagePath,
      file_type: file.type,
      file_size: file.size,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (dbError) {
    // Clean up the uploaded file if DB insert fails
    await adminClient.storage
      .from("campaign-documents")
      .remove([storagePath]);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ file: fileRecord });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await request.json();
  if (!fileId) {
    return NextResponse.json({ error: "File ID diperlukan" }, { status: 400 });
  }

  const { data: fileRecord } = await supabase
    .from("campaign_files")
    .select("file_url, uploaded_by")
    .eq("id", fileId)
    .single();

  if (!fileRecord || fileRecord.uploaded_by !== user.id) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
  }

  const adminClient = createAdminClient();
  await adminClient.storage
    .from("campaign-documents")
    .remove([fileRecord.file_url]);

  await supabase.from("campaign_files").delete().eq("id", fileId);

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("file_id");

  if (!fileId) {
    return NextResponse.json({ error: "File ID diperlukan" }, { status: 400 });
  }

  const { data: fileRecord } = await supabase
    .from("campaign_files")
    .select("file_url, file_name")
    .eq("id", fileId)
    .single();

  if (!fileRecord) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
  }

  const adminClient = createAdminClient();
  const { data: signedUrl, error } = await adminClient.storage
    .from("campaign-documents")
    .createSignedUrl(fileRecord.file_url, 60 * 5); // 5 minutes

  if (error || !signedUrl) {
    return NextResponse.json({ error: "Gagal membuat signed URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signedUrl.signedUrl, name: fileRecord.file_name });
}

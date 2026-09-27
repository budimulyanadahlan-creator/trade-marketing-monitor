import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { compressImageIfNeeded } from "@/lib/image-compress";
import { canManagePosm } from "@/lib/posm";
import {
  parsePosmPhotoKind,
  POSM_PHOTO_BUCKET,
  POSM_PHOTO_MAX_SIZE,
  posmPhotoPath,
  validatePosmPhoto,
  type PosmPhotoKind,
} from "@/lib/posm-photo";
import type { UserRole } from "@/types/database";

// Upload/ganti (POST) dan hapus (DELETE) foto item POSM, asset, atau catatan
// penempatan. Storage dan tabel ditulis dengan client milik user, jadi policy
// can_manage_posm() (migrasi 048 & RLS tabel) tetap jadi penjaga akhir.

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireWriter(): Promise<{ supabase: Supabase } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active, department:departments(name)")
    .eq("id", user.id)
    .single();

  if (
    !profile?.is_active ||
    !canManagePosm({
      role: profile.role as UserRole,
      departmentName: (profile.department as { name: string } | null)?.name,
    })
  ) {
    return { response: NextResponse.json({ error: "Anda tidak memiliki akses." }, { status: 403 }) };
  }

  return { supabase };
}

async function loadRecord(supabase: Supabase, table: string, id: string) {
  const { data } = await supabase
    .from(table as "posm_items")
    .select("id, photo_path")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return data as { id: string; photo_path: string | null } | null;
}

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await requireWriter();
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const formData = await request.formData();
  const kind = formData.get("kind");
  const id = formData.get("id");
  const file = formData.get("file") as File | null;

  const table = parsePosmPhotoKind(kind);
  if (!table || typeof id !== "string" || !id) return badRequest("Data foto tidak valid.");
  if (!file) return badRequest("Foto tidak ditemukan.");

  const invalid = validatePosmPhoto(file);
  if (invalid) return badRequest(invalid);

  const record = await loadRecord(supabase, table, id);
  if (!record) return badRequest("Data tidak ditemukan.", 404);

  let processed;
  try {
    processed = await compressImageIfNeeded(Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return badRequest("Gagal memproses gambar.", 500);
  }
  if (processed.buffer.length > POSM_PHOTO_MAX_SIZE) return badRequest("Ukuran foto maksimal 5 MB.");

  const storage = supabase.storage.from(POSM_PHOTO_BUCKET);
  const path = posmPhotoPath(kind as PosmPhotoKind, id, Date.now());

  const { error: uploadError } = await storage.upload(path, processed.buffer, {
    contentType: processed.contentType,
    upsert: false,
  });
  if (uploadError) return badRequest(uploadError.message, 500);

  const { error: dbError } = await supabase
    .from(table as "posm_items")
    .update({ photo_path: path })
    .eq("id", id)
    .is("deleted_at", null);
  if (dbError) {
    await storage.remove([path]);
    return badRequest(dbError.message, 500);
  }

  // Foto lama tidak lagi dirujuk; best-effort, record sudah tersimpan.
  if (record.photo_path) await storage.remove([record.photo_path]);

  revalidatePath("/monitoring-posm", "layout");
  return NextResponse.json({ photo_path: path });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireWriter();
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const { kind, id } = (await request.json()) as { kind?: unknown; id?: unknown };
  const table = parsePosmPhotoKind(kind);
  if (!table || typeof id !== "string" || !id) return badRequest("Data foto tidak valid.");

  const record = await loadRecord(supabase, table, id);
  if (!record) return badRequest("Data tidak ditemukan.", 404);
  if (!record.photo_path) return NextResponse.json({ success: true });

  const { error } = await supabase
    .from(table as "posm_items")
    .update({ photo_path: null })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return badRequest(error.message, 500);

  await supabase.storage.from(POSM_PHOTO_BUCKET).remove([record.photo_path]);

  revalidatePath("/monitoring-posm", "layout");
  return NextResponse.json({ success: true });
}

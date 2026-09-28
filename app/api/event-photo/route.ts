import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { compressImageIfNeeded } from "@/lib/image-compress";
import { EVENT_PHOTO_BUCKET, EVENT_PHOTO_MAX, eventPhotoLimitError, eventPhotoPath } from "@/lib/event";
import { POSM_PHOTO_MAX_LABEL, POSM_PHOTO_MAX_SIZE, validatePosmPhoto } from "@/lib/posm-photo";
import { requirePosmWriter } from "@/lib/posm-writer";

// Upload (POST) dan hapus (DELETE) foto dokumentasi event. Storage dan tabel
// ditulis dengan client milik user, jadi storage policy, RLS, dan trigger
// batas 10 foto (migrasi 060) tetap jadi penjaga akhir.

type Supabase = Awaited<ReturnType<typeof requirePosmWriter>>["supabase"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireWriter(): Promise<{ supabase: Supabase } | { response: NextResponse }> {
  try {
    return await requirePosmWriter();
  } catch (e) {
    return e instanceof Error && e.message === "Unauthorized"
      ? { response: badRequest("Unauthorized", 401) }
      : { response: badRequest("Anda tidak memiliki akses.", 403) };
  }
}

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/** Pesan ramah untuk error trigger/RLS database. */
function dbErrorMessage(message: string) {
  if (message.includes("FOTO_MAKSIMAL")) return eventPhotoLimitError(EVENT_PHOTO_MAX, 1) as string;
  if (message.includes("EVENT_TIDAK_DITEMUKAN")) return "Event tidak ditemukan atau sudah dihapus.";
  return message;
}

function revalidateEvent(eventId: string) {
  revalidatePath("/monitoring-event");
  revalidatePath(`/monitoring-event/${eventId}`);
}

export async function POST(request: NextRequest) {
  const auth = await requireWriter();
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const formData = await request.formData();
  const eventId = formData.get("event_id");
  const file = formData.get("file") as File | null;

  if (typeof eventId !== "string" || !UUID.test(eventId)) return badRequest("Data foto tidak valid.");
  if (!file) return badRequest("Foto tidak ditemukan.");

  const invalid = validatePosmPhoto(file);
  if (invalid) return badRequest(invalid);

  const { data: event } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!event) return badRequest("Event tidak ditemukan.", 404);

  // Cek awal agar tidak mengupload file yang pasti ditolak trigger.
  const { count } = await supabase
    .from("event_photos")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("deleted_at", null);
  const limitError = eventPhotoLimitError(count ?? 0, 1);
  if (limitError) return badRequest(limitError);

  let processed;
  try {
    processed = await compressImageIfNeeded(Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return badRequest("Gagal memproses gambar.", 500);
  }
  if (processed.buffer.length > POSM_PHOTO_MAX_SIZE) return badRequest(`Ukuran foto maksimal ${POSM_PHOTO_MAX_LABEL}.`);

  const storage = supabase.storage.from(EVENT_PHOTO_BUCKET);
  const path = eventPhotoPath(eventId, Date.now());

  const { error: uploadError } = await storage.upload(path, processed.buffer, {
    contentType: processed.contentType,
    upsert: false,
  });
  if (uploadError) return badRequest(uploadError.message, 500);

  const { error: dbError } = await supabase.from("event_photos").insert({ event_id: eventId, path });
  if (dbError) {
    await storage.remove([path]);
    // Batas 10 bisa terlampaui oleh upload bersamaan; trigger yang menolak.
    return badRequest(dbErrorMessage(dbError.message), dbError.message.includes("FOTO_MAKSIMAL") ? 400 : 500);
  }

  revalidateEvent(eventId);
  return NextResponse.json({ path });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireWriter();
  if ("response" in auth) return auth.response;
  const { supabase } = auth;

  const { id } = (await request.json()) as { id?: unknown };
  if (typeof id !== "string" || !UUID.test(id)) return badRequest("Data foto tidak valid.");

  const { data: photo } = await supabase
    .from("event_photos")
    .select("id, event_id, path")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!photo) return badRequest("Foto tidak ditemukan.", 404);

  // Soft delete dicatat di audit log (trigger migrasi 060).
  const { error } = await supabase
    .from("event_photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return badRequest(error.message, 500);

  // Best-effort: baris sudah terhapus, objek storage tidak lagi dirujuk.
  await supabase.storage.from(EVENT_PHOTO_BUCKET).remove([photo.path]);

  revalidateEvent(photo.event_id);
  return NextResponse.json({ success: true });
}

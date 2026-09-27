import type { createClient } from "@/lib/supabase/server";
import { POSM_PHOTO_BUCKET } from "@/lib/posm-photo";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const SIGNED_URL_TTL = 60 * 60; // 1 jam

/**
 * Signed URL untuk foto POSM/asset, dibuat dengan client milik user sehingga
 * policy baca bucket (non-distributor) tetap berlaku. Path tanpa URL dilewati.
 */
export async function signPosmPhotos(supabase: Supabase, paths: (string | null)[]) {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;

  const { data } = await supabase.storage.from(POSM_PHOTO_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL);
  for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  return urls;
}

/** Helper untuk baris: path → URL (atau null). */
export function photoUrlOf(urls: Map<string, string>, path: string | null) {
  return path ? (urls.get(path) ?? null) : null;
}

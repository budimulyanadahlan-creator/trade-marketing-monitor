import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database";
import type { AppointedUploader } from "@/lib/claim-document-uploaders";

type UploaderJoinRow = {
  document_type_id: string;
  user: { id: string; role: UserRole; is_active: boolean; distributor_id: string | null } | null;
};

/**
 * Akun yang ditunjuk sebagai pengunggah khusus, dikelompokkan per jenis
 * dokumen klaim. Tanpa `documentTypeIds` → semua penunjukan (tabelnya kecil).
 *
 * Panggil dengan klien service-role: ini pencarian otorisasi sisi server, dan
 * akun distributor tidak selalu boleh membaca baris akun lain lewat RLS.
 * Aturannya sendiri ada di lib/claim-document-uploaders.ts
 * (effectiveSpecialUploaderIds).
 */
export async function fetchAppointedUploadersByDocType(
  admin: SupabaseClient<Database>,
  documentTypeIds?: string[]
): Promise<Map<string, AppointedUploader[]>> {
  const byDocType = new Map<string, AppointedUploader[]>();
  if (documentTypeIds && documentTypeIds.length === 0) return byDocType;

  let query = admin
    .from("claim_document_type_uploaders")
    .select(
      "document_type_id, user:users!claim_document_type_uploaders_user_id_fkey(id, role, is_active, distributor_id)"
    );
  if (documentTypeIds) query = query.in("document_type_id", documentTypeIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as UploaderJoinRow[]) {
    if (!row.user) continue;
    const list = byDocType.get(row.document_type_id) ?? [];
    list.push({
      id: row.user.id,
      role: row.user.role,
      is_active: row.user.is_active,
      distributor_id: row.user.distributor_id ?? null,
    });
    byDocType.set(row.document_type_id, list);
  }
  return byDocType;
}

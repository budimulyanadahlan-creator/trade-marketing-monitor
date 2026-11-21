import { createClient } from "@/lib/supabase/server";
import { ClaimRequirementsTable, type UploaderAccount } from "./claim-requirements-table";

const ACCOUNT_COLUMNS = "id, full_name, role, is_active, distributor_id, distributor_scope";

export default async function ClaimRequirementsPage() {
  const supabase = await createClient();

  const [
    { data: documentTypes },
    { data: categories },
    { data: requirements },
    { data: uploaders },
    { data: pusatAccounts },
    { data: distributors },
  ] = await Promise.all([
    supabase.from("claim_document_types").select("*").order("sort_order"),
    supabase.from("promotion_categories").select("*").order("name"),
    supabase.from("claim_requirements").select("*"),
    supabase.from("claim_document_type_uploaders").select("document_type_id, user_id"),
    supabase
      .from("users")
      .select(ACCOUNT_COLUMNS)
      .eq("role", "distributor")
      .eq("distributor_scope", "pusat")
      .order("full_name"),
    supabase.from("distributors").select("id, name"),
  ]);

  // Akun yang sudah ditunjuk tetapi tidak lagi distributor Pusat tetap harus
  // tampil (sebagai tidak dihitung) supaya admin bisa mencabutnya.
  const accounts = [...(pusatAccounts ?? [])];
  const known = new Set(accounts.map((a) => a.id));
  const missingIds = [...new Set((uploaders ?? []).map((u) => u.user_id))].filter(
    (id) => !known.has(id)
  );
  if (missingIds.length > 0) {
    const { data: extra } = await supabase.from("users").select(ACCOUNT_COLUMNS).in("id", missingIds);
    accounts.push(...(extra ?? []));
  }

  const companyName = new Map((distributors ?? []).map((d) => [d.id, d.name]));
  const uploaderAccounts: UploaderAccount[] = accounts.map((a) => ({
    ...a,
    company_name: a.distributor_id ? companyName.get(a.distributor_id) ?? null : null,
  }));

  return (
    <ClaimRequirementsTable
      documentTypes={documentTypes ?? []}
      categories={categories ?? []}
      requirements={requirements ?? []}
      uploaders={uploaders ?? []}
      uploaderAccounts={uploaderAccounts}
    />
  );
}

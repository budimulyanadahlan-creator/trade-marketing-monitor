import { createClient } from "@/lib/supabase/server";
import { ClaimRequirementsTable } from "./claim-requirements-table";

export default async function ClaimRequirementsPage() {
  const supabase = await createClient();

  const [{ data: documentTypes }, { data: categories }, { data: requirements }] =
    await Promise.all([
      supabase.from("claim_document_types").select("*").order("sort_order"),
      supabase.from("promotion_categories").select("*").order("name"),
      supabase.from("claim_requirements").select("*"),
    ]);

  return (
    <ClaimRequirementsTable
      documentTypes={documentTypes ?? []}
      categories={categories ?? []}
      requirements={requirements ?? []}
    />
  );
}

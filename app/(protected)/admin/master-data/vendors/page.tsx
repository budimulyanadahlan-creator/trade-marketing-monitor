import { createClient } from "@/lib/supabase/server";
import { VendorsTable } from "./vendors-table";

export default async function VendorsPage() {
  const supabase = await createClient();

  const { data: vendors } = await supabase
    .from("vendors")
    .select("*")
    .order("name");

  return <VendorsTable vendors={vendors ?? []} />;
}

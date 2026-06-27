import { createClient } from "@/lib/supabase/server";
import { RegionsTable } from "./regions-table";

export default async function RegionsPage() {
  const supabase = await createClient();

  const { data: regions } = await supabase
    .from("regions")
    .select("*")
    .order("name");

  return <RegionsTable regions={regions ?? []} />;
}

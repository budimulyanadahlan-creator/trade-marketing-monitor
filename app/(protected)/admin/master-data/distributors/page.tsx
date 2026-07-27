import { createClient } from "@/lib/supabase/server";
import { DistributorsTable } from "./distributors-table";

export default async function DistributorsPage() {
  const supabase = await createClient();

  const { data: distributors } = await supabase
    .from("distributors")
    .select("*")
    .order("name");

  return <DistributorsTable distributors={distributors ?? []} />;
}

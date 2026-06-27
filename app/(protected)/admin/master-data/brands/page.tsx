import { createClient } from "@/lib/supabase/server";
import { BrandsTable } from "./brands-table";

export default async function BrandsPage() {
  const supabase = await createClient();

  const { data: brands } = await supabase
    .from("brands")
    .select("*")
    .order("name");

  return <BrandsTable brands={brands ?? []} />;
}

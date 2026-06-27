import { createClient } from "@/lib/supabase/server";
import { CategoriesTable } from "./categories-table";

export default async function CategoriesPage() {
  const supabase = await createClient();

  const { data: categories } = await supabase
    .from("promotion_categories")
    .select("*")
    .order("account_code");

  return <CategoriesTable categories={categories ?? []} />;
}

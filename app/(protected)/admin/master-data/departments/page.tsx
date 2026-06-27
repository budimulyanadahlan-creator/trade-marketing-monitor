import { createClient } from "@/lib/supabase/server";
import { DepartmentsTable } from "./departments-table";

export default async function DepartmentsPage() {
  const supabase = await createClient();

  const { data: departments } = await supabase
    .from("departments")
    .select("*")
    .order("name");

  return <DepartmentsTable departments={departments ?? []} />;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function formatSkpNumber(sequence: number, date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${String(sequence).padStart(4, "0")}/WWI/${month}/${year}`;
}

export async function generateSkpNumber(
  approvalDate: Date,
  supabase: SupabaseClient<Database>
): Promise<string> {
  const year = approvalDate.getFullYear();
  const month = approvalDate.getMonth() + 1;

  const { data, error } = await supabase.rpc("increment_skp_counter", {
    p_year: year,
    p_month: month,
  });

  if (error) throw new Error(`Failed to generate SKP number: ${error.message}`);

  return formatSkpNumber(data, approvalDate);
}

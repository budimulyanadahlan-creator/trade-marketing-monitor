import { createClient } from "@/lib/supabase/server";
import { ChannelsTable } from "./channels-table";

export default async function ChannelsPage() {
  const supabase = await createClient();

  const { data: channels } = await supabase
    .from("channels")
    .select("*")
    .order("name");

  return <ChannelsTable channels={channels ?? []} />;
}

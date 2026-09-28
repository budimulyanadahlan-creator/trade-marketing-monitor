import type { createClient } from "@/lib/supabase/server";
import type { EventFormOptions, Option } from "./event-form-dialog";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Pilihan yang sudah dipakai event lama; tetap ditampilkan walau nonaktif. */
export type EventFormKeep = {
  region?: Option | null;
  distributor?: Option | null;
  vendor?: Option | null;
  brands?: Option[];
};

function withKept(active: Option[] | null, kept: (Option | null | undefined)[]): Option[] {
  const options = [...(active ?? [])];
  for (const k of kept) {
    if (k && !options.some((o) => o.id === k.id)) options.push({ id: k.id, name: `${k.name} (nonaktif)` });
  }
  return options;
}

/**
 * Pilihan form event: master data aktif saja, ditambah pilihan event yang
 * sedang diedit meskipun sudah nonaktif.
 */
export async function loadEventFormOptions(supabase: Supabase, keep: EventFormKeep = {}): Promise<EventFormOptions> {
  const [{ data: regions }, { data: brands }, { data: distributors }, { data: vendors }] = await Promise.all([
    supabase.from("regions").select("id, name").eq("is_active", true).order("name"),
    supabase.from("brands").select("id, name").eq("is_active", true).order("name"),
    supabase.from("distributors").select("id, name").eq("is_active", true).order("name"),
    supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
  ]);

  return {
    regions: withKept(regions, [keep.region]),
    brands: withKept(brands, keep.brands ?? []),
    distributors: withKept(distributors, [keep.distributor]),
    vendors: withKept(vendors, [keep.vendor]),
  };
}

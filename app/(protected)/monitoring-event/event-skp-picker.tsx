"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { searchEventCampaignsAction, type EventCampaignOption } from "@/app/actions/event";
import { SearchInput } from "@/components/ui/search-input";

export type LinkedCampaign = { id: string; skp_number: string | null; name: string };

/**
 * Pilih banyak SKP (opsional) lewat pencarian nomor SKP/AA atau judul.
 * Setiap SKP terpilih dikirim sebagai input tersembunyi `campaign_ids`.
 * `onPick` dipanggil saat SKP baru dipilih, untuk saran isian form.
 */
export function EventSkpPicker({
  selected,
  onPick,
  onRemove,
  disabled,
}: {
  selected: LinkedCampaign[];
  onPick: (campaign: EventCampaignOption) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EventCampaignOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Nomor permintaan terbaru; hasil dari pencarian lama diabaikan.
  const latestRequest = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Pencarian (debounce 300 ms) dipicu langsung dari perubahan input.
  function handleQueryChange(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    const request = ++latestRequest.current;

    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const result = await searchEventCampaignsAction(q);
      if (request !== latestRequest.current) return;
      setResults(result.campaigns);
      setError(result.error ?? null);
      setLoading(false);
    }, 300);
  }

  const q = query.trim();
  const selectedIds = new Set(selected.map((c) => c.id));
  const available = results.filter((c) => !selectedIds.has(c.id));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <ul className="space-y-1.5">
          {selected.map((c) => (
            <li
              key={c.id}
              className="flex h-9 items-center justify-between gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm"
            >
              <input type="hidden" name="campaign_ids" value={c.id} />
              <span className="min-w-0 truncate text-slate-100">
                <code className="text-emerald-300">{c.skp_number ?? "Tanpa nomor"}</code>
                <span className="text-slate-400"> • {c.name}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                disabled={disabled}
                aria-label={`Lepas SKP ${c.skp_number ?? c.name}`}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/10 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SearchInput value={query} onChange={handleQueryChange} placeholder="Cari nomor SKP atau judul SKP..." />
      {q.length >= 2 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-white/10 bg-slate-900 text-sm">
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-2 text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Mencari...
            </p>
          ) : error ? (
            <p className="px-3 py-2 text-rose-400">{error}</p>
          ) : available.length === 0 ? (
            <p className="px-3 py-2 text-slate-500">SKP tidak ditemukan.</p>
          ) : (
            available.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(c);
                  handleQueryChange("");
                }}
                className="block w-full px-3 py-2 text-left hover:bg-white/5"
              >
                <code className="text-emerald-300">{c.skp_number ?? "Tanpa nomor"}</code>
                <span className="text-slate-400"> • {c.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

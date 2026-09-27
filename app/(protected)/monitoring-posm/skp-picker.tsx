"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { searchPosmCampaignsAction, type PosmCampaignOption } from "@/app/actions/posm";
import { SearchInput } from "@/components/ui/search-input";

/**
 * Pilih SKP (opsional) lewat pencarian nomor SKP/AA atau nama campaign.
 * Nilai terpilih dikirim sebagai input tersembunyi `name`.
 */
export function SkpPicker({
  name,
  defaultValue,
  disabled,
}: {
  name: string;
  defaultValue: PosmCampaignOption | null;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<PosmCampaignOption | null>(defaultValue);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosmCampaignOption[]>([]);
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
      const result = await searchPosmCampaignsAction(q);
      if (request !== latestRequest.current) return;
      setResults(result.campaigns);
      setError(result.error ?? null);
      setLoading(false);
    }, 300);
  }

  if (selected) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm">
        <input type="hidden" name={name} value={selected.id} />
        <span className="min-w-0 truncate text-slate-100">
          <code className="text-emerald-300">{selected.skp_number ?? "Tanpa nomor"}</code>
          <span className="text-slate-400"> • {selected.name}</span>
        </span>
        <button
          type="button"
          onClick={() => setSelected(null)}
          disabled={disabled}
          aria-label="Lepas SKP"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/10 hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const q = query.trim();

  return (
    <div className="space-y-1">
      <SearchInput value={query} onChange={handleQueryChange} placeholder="Cari nomor SKP atau nama campaign..." />
      {q.length >= 2 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-white/10 bg-slate-900 text-sm">
          {loading ? (
            <p className="flex items-center gap-2 px-3 py-2 text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Mencari...
            </p>
          ) : error ? (
            <p className="px-3 py-2 text-rose-400">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-slate-500">SKP tidak ditemukan.</p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelected(c);
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

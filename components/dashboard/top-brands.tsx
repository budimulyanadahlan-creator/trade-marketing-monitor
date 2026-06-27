import { formatIDR } from "@/lib/utils";

interface BrandData {
  name: string;
  spent: number;
  budget: number;
}

export function TopBrands({ data }: { data: BrandData[] }) {
  const maxSpent = Math.max(...data.map((b) => b.spent), 1);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-5">
      <p className="text-sm font-medium text-slate-300 mb-4">
        Top 5 Brand — Realisasi Tertinggi
      </p>
      {data.length === 0 ? (
        <p className="text-slate-500 text-sm">Belum ada data</p>
      ) : (
        <div className="space-y-4">
          {data.map((brand, i) => (
            <div key={brand.name}>
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-sm text-slate-300 flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-4 shrink-0">{i + 1}.</span>
                  <span className="truncate">{brand.name}</span>
                </span>
                <span className="text-xs font-mono text-slate-400 shrink-0 ml-2">
                  {formatIDR(brand.spent)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-800">
                <div
                  className="h-1.5 rounded-full bg-emerald-500"
                  style={{ width: `${(brand.spent / maxSpent) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

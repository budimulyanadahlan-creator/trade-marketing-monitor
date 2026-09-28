import { EVENT_STATUS_LABELS, type EventKpiPair, type EventKpis } from "@/lib/event";
import { cn, formatIDR } from "@/lib/utils";

const formatCount = (n: number) => n.toLocaleString("id-ID");

function KpiShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4 flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      {children}
    </div>
  );
}

/**
 * Kartu target/rencana vs aktual/terpakai. `overIsBad` membalik warna persen
 * untuk budget, di mana melebihi rencana adalah peringatan.
 */
function PairCard({
  label,
  pair,
  format,
  targetLabel,
  actualLabel,
  overIsBad = false,
}: {
  label: string;
  pair: EventKpiPair;
  format: (n: number) => string;
  targetLabel: string;
  actualLabel: string;
  overIsBad?: boolean;
}) {
  const percent = pair.target > 0 ? (pair.actual / pair.target) * 100 : null;
  const good = percent !== null && (overIsBad ? percent <= 100 : percent >= 100);

  return (
    <KpiShell label={label}>
      <p className="text-xl font-bold tracking-tight text-slate-100">{format(pair.actual)}</p>
      <p className="text-xs text-slate-400">
        {actualLabel} dari {targetLabel.toLowerCase()} {format(pair.target)}
      </p>
      {percent !== null && (
        <p className={cn("text-xs font-medium", good ? "text-emerald-400" : "text-amber-400")}>
          {percent.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% dari {targetLabel.toLowerCase()}
        </p>
      )}
    </KpiShell>
  );
}

export function EventKpiRow({ kpis }: { kpis: EventKpis }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      <KpiShell label="Jumlah Event">
        <p className="text-xl font-bold tracking-tight text-slate-100">{formatCount(kpis.counts.total)}</p>
        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {(["rencana", "terlaksana", "batal"] as const).map((status) => (
            <div key={status} className="flex gap-1">
              <dt className="text-slate-500">{EVENT_STATUS_LABELS[status]}</dt>
              <dd className="font-medium text-slate-300">{formatCount(kpis.counts[status])}</dd>
            </div>
          ))}
        </dl>
      </KpiShell>
      <PairCard label="Peserta" pair={kpis.participants} format={formatCount} targetLabel="Target" actualLabel="Aktual" />
      <PairCard label="Sales" pair={kpis.sales} format={formatIDR} targetLabel="Target" actualLabel="Aktual" />
      <PairCard
        label="Budget Event"
        pair={kpis.budget}
        format={formatIDR}
        targetLabel="Rencana"
        actualLabel="Realisasi"
        overIsBad
      />
      <PairCard
        label="Budget Sample"
        pair={kpis.sampleBudget}
        format={formatIDR}
        targetLabel="Rencana"
        actualLabel="Terpakai"
        overIsBad
      />
    </div>
  );
}

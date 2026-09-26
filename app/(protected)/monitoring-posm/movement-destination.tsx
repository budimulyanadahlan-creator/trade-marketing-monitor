/** Tujuan mutasi Keluar: region, distributor (opsional), dan nomor SKP (opsional). */
export function MovementDestination({
  regionName,
  distributorName,
  campaignSkp,
  campaignName,
}: {
  regionName: string | null;
  distributorName: string | null;
  campaignSkp: string | null;
  campaignName: string | null;
}) {
  if (!regionName && !distributorName && !campaignSkp && !campaignName) {
    return <span className="text-slate-500">—</span>;
  }

  return (
    <div className="space-y-0.5">
      {regionName && <p className="text-slate-300">{regionName}</p>}
      {distributorName && <p className="text-xs text-slate-500">{distributorName}</p>}
      {(campaignSkp || campaignName) && (
        <p className="text-xs" title={campaignName ?? undefined}>
          <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
            {campaignSkp ?? campaignName}
          </code>
        </p>
      )}
    </div>
  );
}

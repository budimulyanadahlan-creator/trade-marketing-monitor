/**
 * Tujuan mutasi Keluar: region, distributor (opsional), dan nomor SKP (opsional).
 * Mutasi gimmick juga menampilkan jenis tujuan dan PIC/penerima.
 */
export function MovementDestination({
  destinationLabel,
  regionName,
  distributorName,
  recipientName,
  campaignSkp,
  campaignName,
}: {
  destinationLabel?: string | null;
  regionName: string | null;
  distributorName: string | null;
  recipientName?: string | null;
  campaignSkp: string | null;
  campaignName: string | null;
}) {
  if (!destinationLabel && !regionName && !distributorName && !recipientName && !campaignSkp && !campaignName) {
    return <span className="text-slate-500">—</span>;
  }

  return (
    <div className="space-y-0.5">
      {destinationLabel && <p className="text-xs font-medium text-slate-400">{destinationLabel}</p>}
      {regionName && <p className="text-slate-300">{regionName}</p>}
      {distributorName && <p className="text-xs text-slate-500">{distributorName}</p>}
      {recipientName && <p className="text-xs text-slate-500">PIC: {recipientName}</p>}
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

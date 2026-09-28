import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { EventStatus } from "@/types/database";

// Dipakai tabel (client) dan halaman detail (server).
export const EVENT_STATUS_VARIANT: Record<EventStatus, "secondary" | "default" | "destructive"> = {
  rencana: "secondary",
  terlaksana: "default",
  batal: "destructive",
};

export function formatEventDateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

/** Event Terlaksana tanpa foto dokumentasi (eventLacksPhoto). Foto tidak wajib. */
export function NoPhotoBadge() {
  return (
    <Badge variant="outline" title="Event sudah terlaksana tetapi belum ada foto dokumentasi">
      Belum ada foto
    </Badge>
  );
}

/** Event Rencana yang tanggal selesainya sudah lewat (eventNeedsUpdate). */
export function NeedsUpdateBadge() {
  return (
    <Badge variant="warning" title="Tanggal selesai sudah lewat, isi realisasi atau ubah status">
      Perlu update
    </Badge>
  );
}

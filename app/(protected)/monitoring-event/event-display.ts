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

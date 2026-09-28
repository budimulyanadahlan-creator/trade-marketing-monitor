"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EVENT_STATUS_LABELS } from "@/lib/event";
import { formatIDR } from "@/lib/utils";
import type { EventRow } from "@/types/database";
import { EVENT_STATUS_VARIANT, formatEventDateRange } from "./event-display";
import { EventFormDialog, type RegionOption } from "./event-form-dialog";

export type EventListRow = Pick<
  EventRow,
  | "id"
  | "name"
  | "event_type"
  | "start_date"
  | "end_date"
  | "location"
  | "pic_name"
  | "target_participants"
  | "target_sales"
  | "status"
> & {
  region_name: string | null;
  planned_budget: number | null;
  planned_sample_budget: number | null;
};

const detailHref = (id: string) => `/monitoring-event/${id}`;

// ---- Main Table ----

export function EventsTable({
  events,
  regions,
  canManage,
  periodLabel,
}: {
  events: EventListRow[];
  regions: RegionOption[];
  canManage: boolean;
  periodLabel: string;
}) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          {events.length} event di {periodLabel}
        </p>
        {canManage && (
          <EventFormDialog
            regions={regions}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Tambah Event
              </Button>
            }
          />
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Tanggal</TableHead>
              <TableHead>Nama Event</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>PIC</TableHead>
              <TableHead className="text-right">Target Peserta</TableHead>
              <TableHead className="text-right">Target Sales</TableHead>
              <TableHead className="text-right">Budget Event</TableHead>
              <TableHead className="text-right">Budget Sample</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length > 0 ? (
              events.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer"
                  onClick={() => router.push(detailHref(e.id))}
                >
                  <TableCell className="text-slate-300 whitespace-nowrap">
                    {formatEventDateRange(e.start_date, e.end_date)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={detailHref(e.id)}
                      onClick={(ev) => ev.stopPropagation()}
                      className="hover:text-emerald-300 hover:underline underline-offset-4"
                    >
                      {e.name}
                    </Link>
                    <div className="text-xs text-slate-500">{e.event_type}</div>
                  </TableCell>
                  <TableCell className="text-slate-300">{e.region_name ?? "—"}</TableCell>
                  <TableCell className="text-slate-300">{e.location}</TableCell>
                  <TableCell className="text-slate-300">{e.pic_name}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.target_participants.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">{formatIDR(e.target_sales)}</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.planned_budget === null ? "—" : formatIDR(e.planned_budget)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-300">
                    {e.planned_sample_budget === null ? "—" : formatIDR(e.planned_sample_budget)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={EVENT_STATUS_VARIANT[e.status]}>{EVENT_STATUS_LABELS[e.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                  Belum ada event di {periodLabel}.
                  {canManage && " Tambah event pertama lewat tombol Tambah Event."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

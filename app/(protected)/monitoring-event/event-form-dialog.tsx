"use client";

import { useActionState, useState, type ReactNode } from "react";
import { AlertCircle, Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  createEventAction,
  updateEventAction,
  type CreateEventState,
  type EventCampaignOption,
} from "@/app/actions/event";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_TYPES, suggestFromCampaign, type EventSuggestibleFields } from "@/lib/event";
import { cn } from "@/lib/utils";
import type { EventType } from "@/types/database";
import { EventSkpPicker, type LinkedCampaign } from "./event-skp-picker";

export type Option = { id: string; name: string };

/**
 * Pilihan master data. Hanya yang aktif, ditambah pilihan event yang sedang
 * diedit meskipun sudah nonaktif (lihat loadEventFormOptions).
 */
export type EventFormOptions = {
  regions: Option[];
  brands: Option[];
  distributors: Option[];
  vendors: Option[];
};

/** Nilai awal form edit. */
export type EventFormValues = {
  id: string;
  name: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  region_id: string;
  location: string;
  pic_name: string;
  target_participants: number;
  target_sales: number;
  planned_budget: number;
  planned_sample_budget: number;
  distributor_id: string | null;
  vendor_id: string | null;
  notes: string | null;
  brand_ids: string[];
  campaigns: LinkedCampaign[];
};

type PendingSuggestion = { skp: string; changes: Partial<EventSuggestibleFields> };

function initialLinks(event?: EventFormValues): EventSuggestibleFields {
  return {
    region_id: event?.region_id ?? "",
    distributor_id: event?.distributor_id ?? "",
    brand_ids: event?.brand_ids ?? [],
  };
}

/** Form tambah (tanpa `event`) atau edit (dengan `event`). */
export function EventFormDialog({
  options,
  event,
  trigger,
}: {
  options: EventFormOptions;
  event?: EventFormValues;
  trigger: ReactNode;
}) {
  const isEdit = Boolean(event);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(event?.start_date ?? "");
  const [endDate, setEndDate] = useState(event?.end_date ?? "");
  // Region, distributor, dan brand dikontrol karena bisa diisi dari SKP.
  const [links, setLinks] = useState<EventSuggestibleFields>(() => initialLinks(event));
  const [campaigns, setCampaigns] = useState<LinkedCampaign[]>(event?.campaigns ?? []);
  const [pending, setPending] = useState<PendingSuggestion | null>(null);
  const [state, formAction, isPending] = useActionState(
    async (prev: CreateEventState, formData: FormData) => {
      const result = isEdit ? await updateEventAction(prev, formData) : await createEventAction(prev, formData);
      if (result.success) {
        toast.success(isEdit ? "Event diperbarui" : "Event ditambahkan");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  const nameOf = (list: Option[], id: string) => list.find((o) => o.id === id)?.name ?? id;
  const has = (list: Option[], id: string | null) => (id && list.some((o) => o.id === id) ? id : null);

  // Saran dari SKP: field kosong langsung diisi, field yang sudah berisi
  // menunggu konfirmasi. Master data nonaktif tidak disarankan.
  function handlePick(c: EventCampaignOption) {
    setCampaigns((prev) => [...prev, { id: c.id, skp_number: c.skp_number, name: c.name }]);
    const { fill, confirm } = suggestFromCampaign(links, {
      region_id: has(options.regions, c.region_id),
      distributor_id: has(options.distributors, c.distributor_id),
      brand_id: has(options.brands, c.brand_id),
    });
    setLinks((prev) => ({ ...prev, ...fill }));
    setPending(Object.keys(confirm).length ? { skp: c.skp_number ?? c.name, changes: confirm } : null);
  }

  function toggleBrand(id: string) {
    setLinks((prev) => ({
      ...prev,
      brand_ids: prev.brand_ids.includes(id) ? prev.brand_ids.filter((b) => b !== id) : [...prev.brand_ids, id],
    }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStartDate(event?.start_date ?? "");
          setEndDate(event?.end_date ?? "");
          setLinks(initialLinks(event));
          setCampaigns(event?.campaigns ?? []);
          setPending(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Event" : "Tambah Event"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {event && <input type="hidden" name="id" value={event.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="evt-name">Nama Event</Label>
              <Input
                id="evt-name"
                name="name"
                placeholder="Contoh: Senam Sehat Agustusan"
                defaultValue={event?.name}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-type">Jenis</Label>
              <Select
                id="evt-type"
                name="event_type"
                defaultValue={event?.event_type ?? ""}
                placeholder="Pilih jenis"
                required
                disabled={isPending}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-start">Tanggal Mulai</Label>
              <Input
                id="evt-start"
                name="start_date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartDate(next);
                  // Tanggal selesai ikut maju bila tanggal mulai digeser melewatinya.
                  if (next && endDate && endDate < next) setEndDate(next);
                }}
                required
                disabled={isPending}
              />
              <p className="text-xs text-slate-500">
                Kuartal event mengikuti tanggal mulai. Tanggal selesai ikut maju bila terlewati.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-end">Tanggal Selesai</Label>
              <Input
                id="evt-end"
                name="end_date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              SKP Terkait <span className="font-normal text-slate-500">(opsional)</span>
            </Label>
            <EventSkpPicker
              selected={campaigns}
              onPick={handlePick}
              onRemove={(id) => setCampaigns((prev) => prev.filter((c) => c.id !== id))}
              disabled={isPending}
            />
            <p className="text-xs text-slate-500">
              Region, distributor, dan brand SKP disarankan otomatis. Budget tidak ikut terisi.
            </p>
          </div>

          {pending && (
            <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <p className="flex items-center gap-2 text-amber-300">
                <Lightbulb className="h-4 w-4 flex-shrink-0" />
                SKP <code>{pending.skp}</code> menyarankan isian yang berbeda:
              </p>
              <ul className="list-disc space-y-0.5 pl-10 text-slate-300">
                {pending.changes.region_id && (
                  <li>
                    Region: {nameOf(options.regions, links.region_id)} → {nameOf(options.regions, pending.changes.region_id)}
                  </li>
                )}
                {pending.changes.distributor_id && (
                  <li>
                    Distributor: {nameOf(options.distributors, links.distributor_id)} →{" "}
                    {nameOf(options.distributors, pending.changes.distributor_id)}
                  </li>
                )}
                {pending.changes.brand_ids && (
                  <li>
                    Tambah brand:{" "}
                    {pending.changes.brand_ids
                      .filter((b) => !links.brand_ids.includes(b))
                      .map((b) => nameOf(options.brands, b))
                      .join(", ")}
                  </li>
                )}
              </ul>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>
                  Abaikan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setLinks((prev) => ({ ...prev, ...pending.changes }));
                    setPending(null);
                  }}
                >
                  Terapkan
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-region">Region</Label>
              <Select
                id="evt-region"
                name="region_id"
                value={links.region_id}
                onChange={(e) => setLinks((prev) => ({ ...prev, region_id: e.target.value }))}
                placeholder="Pilih region"
                required
                disabled={isPending}
              >
                {options.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-distributor">
                Distributor <span className="font-normal text-slate-500">(opsional)</span>
              </Label>
              <Select
                id="evt-distributor"
                name="distributor_id"
                value={links.distributor_id}
                onChange={(e) => setLinks((prev) => ({ ...prev, distributor_id: e.target.value }))}
                disabled={isPending}
              >
                <option value="">Tanpa distributor</option>
                {options.distributors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Brand <span className="font-normal text-slate-500">(opsional, bisa lebih dari satu)</span>
            </Label>
            {links.brand_ids.map((id) => (
              <input key={id} type="hidden" name="brand_ids" value={id} />
            ))}
            <div className="flex flex-wrap gap-1.5">
              {options.brands.map((b) => {
                const active = links.brand_ids.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleBrand(b.id)}
                    disabled={isPending}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      active
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-white/10 bg-white/5 text-slate-400 hover:text-slate-200"
                    )}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-location">Lokasi / Nama Outlet</Label>
              <Input
                id="evt-location"
                name="location"
                placeholder="Contoh: Lapangan Merdeka, Medan"
                defaultValue={event?.location}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-pic">PIC</Label>
              <Input
                id="evt-pic"
                name="pic_name"
                placeholder="Nama PIC"
                defaultValue={event?.pic_name}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-target-participants">Target Peserta</Label>
              <Input
                id="evt-target-participants"
                name="target_participants"
                type="number"
                min={0}
                step={1}
                defaultValue={event?.target_participants}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-target-sales">Target Sales (Rp)</Label>
              <Input
                id="evt-target-sales"
                name="target_sales"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.target_sales}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="evt-budget">Rencana Budget Event (Rp)</Label>
              <Input
                id="evt-budget"
                name="planned_budget"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.planned_budget}
                required
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="evt-sample-budget">Rencana Budget Sample (Rp)</Label>
              <Input
                id="evt-sample-budget"
                name="planned_sample_budget"
                type="number"
                min={0}
                step="any"
                defaultValue={event?.planned_sample_budget}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-vendor">
              Vendor Penyelenggara <span className="font-normal text-slate-500">(opsional)</span>
            </Label>
            <Select id="evt-vendor" name="vendor_id" defaultValue={event?.vendor_id ?? ""} disabled={isPending}>
              <option value="">Tanpa vendor</option>
              {options.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="evt-notes">
              Keterangan <span className="font-normal text-slate-500">(opsional)</span>
            </Label>
            <Textarea id="evt-notes" name="notes" rows={3} defaultValue={event?.notes ?? ""} disabled={isPending} />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Simpan"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

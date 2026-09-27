"use client";

import { useActionState, useId, useState } from "react";
import { saveAssetPlacementAction, type SaveAssetPlacementState } from "@/app/actions/posm";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ASSET_CONDITIONS, ASSET_DESTINATION_LABELS } from "@/lib/posm";
import type { AssetCondition, AssetDestination, AssetPlacementRow } from "@/types/database";
import { PhotoField, usePhotoChange } from "./posm-photo";

export type PlacementFormValues = Pick<
  AssetPlacementRow,
  | "id"
  | "event_date"
  | "destination"
  | "region_id"
  | "distributor_id"
  | "store_name"
  | "store_address"
  | "pic_name"
  | "condition"
  | "notes"
  | "is_registration"
> & {
  /** Signed URL foto bukti, null jika tidak ada. */
  photo_url: string | null;
};

type Option = { id: string; name: string; is_active: boolean };

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Form "Pindahkan Asset" (catatan baru) atau edit catatan penempatan yang
 * sudah ada. Nama toko menyarankan nama yang pernah diinput.
 */
export function PlacementDialog({
  assetId,
  assetLabel,
  placement,
  defaultCondition = "Baik",
  regions,
  distributors,
  storeNames,
  trigger,
}: {
  assetId: string;
  assetLabel: string;
  placement: PlacementFormValues | null;
  defaultCondition?: AssetCondition;
  regions: Option[];
  distributors: Option[];
  storeNames: string[];
  trigger: React.ReactNode;
}) {
  const isEdit = placement !== null;
  const initialDestination: AssetDestination = placement?.destination ?? "placed";
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<AssetDestination>(initialDestination);
  const storeListId = useId();
  const photo = usePhotoChange("placement");
  const [state, formAction, isPending] = useActionState(
    async (prev: SaveAssetPlacementState, formData: FormData) => {
      const result = await saveAssetPlacementAction(prev, formData);
      if (result.success) {
        await photo.save(result.id);
        toast.success(isEdit ? "Catatan penempatan diperbarui" : "Perpindahan asset dicatat");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  // Region/distributor nonaktif tetap ditampilkan jika sedang dipakai catatan ini.
  const regionOptions = regions.filter((r) => r.is_active || r.id === placement?.region_id);
  const distributorOptions = distributors.filter((d) => d.is_active || d.id === placement?.distributor_id);

  const title = !isEdit
    ? "Pindahkan Asset"
    : placement.is_registration
      ? "Edit Catatan Pendaftaran"
      : "Edit Catatan Penempatan";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDestination(initialDestination);
          photo.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-slate-400">{assetLabel}</p>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="asset_id" value={assetId} />
          {placement && <input type="hidden" name="id" value={placement.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <DatePicker name="event_date" defaultValue={placement?.event_date ?? todayIso()} disabled={isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-destination">Tujuan</Label>
              <Select
                id="pl-destination"
                name="destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value as AssetDestination)}
                disabled={isPending}
              >
                {(Object.keys(ASSET_DESTINATION_LABELS) as AssetDestination[]).map((d) => (
                  <option key={d} value={d}>
                    {ASSET_DESTINATION_LABELS[d]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {destination === "placed" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pl-region">Region</Label>
                  <Select
                    id="pl-region"
                    name="region_id"
                    defaultValue={placement?.region_id ?? ""}
                    placeholder="Pilih region"
                    required
                    disabled={isPending}
                  >
                    {regionOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pl-distributor">Distributor (opsional)</Label>
                  <Select
                    id="pl-distributor"
                    name="distributor_id"
                    defaultValue={placement?.distributor_id ?? ""}
                    disabled={isPending}
                  >
                    <option value="">Tanpa distributor</option>
                    {distributorOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-store">Nama Toko</Label>
                <Input
                  id="pl-store"
                  name="store_name"
                  list={storeListId}
                  defaultValue={placement?.store_name ?? ""}
                  autoComplete="off"
                  required
                  disabled={isPending}
                />
                <datalist id={storeListId}>
                  {storeNames.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-address">Alamat (opsional)</Label>
                <Input
                  id="pl-address"
                  name="store_address"
                  defaultValue={placement?.store_address ?? ""}
                  disabled={isPending}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-condition">Kondisi</Label>
              <Select
                id="pl-condition"
                name="condition"
                defaultValue={placement?.condition ?? defaultCondition}
                disabled={isPending}
              >
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-pic">PIC / Penerima (opsional)</Label>
              <Input id="pl-pic" name="pic_name" defaultValue={placement?.pic_name ?? ""} disabled={isPending} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pl-notes">Keterangan (opsional)</Label>
            <Textarea
              id="pl-notes"
              name="notes"
              defaultValue={placement?.notes ?? ""}
              placeholder="Contoh: ditarik untuk servis, dipindah ke toko baru"
              disabled={isPending}
              className="min-h-[64px]"
            />
          </div>

          <PhotoField
            label="Foto Bukti (opsional)"
            currentUrl={placement?.photo_url ?? null}
            value={photo.change}
            onChange={photo.setChange}
            disabled={isPending}
          />

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

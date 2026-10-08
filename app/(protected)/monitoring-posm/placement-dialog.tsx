"use client";

import { useActionState, useId, useState } from "react";
import {
  moveMarketingAssetsBulkAction,
  saveAssetPlacementAction,
  type MoveMarketingAssetsBulkState,
  type SaveAssetPlacementState,
} from "@/app/actions/posm";
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
import { ASSET_CONDITIONS, ASSET_DESTINATION_LABELS, ASSET_KEEP_CONDITION } from "@/lib/posm";
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
 * Isian catatan penempatan (tanggal, tujuan, lokasi toko, kondisi, PIC,
 * keterangan), dipakai bersama oleh Pindahkan per unit dan Pindahkan massal.
 * Dengan keepCondition, kondisi default-nya "Pertahankan kondisi masing-masing".
 */
function PlacementFields({
  placement,
  defaultCondition,
  keepCondition = false,
  destination,
  onDestinationChange,
  regions,
  distributors,
  storeNames,
  disabled,
}: {
  placement: PlacementFormValues | null;
  defaultCondition: AssetCondition;
  keepCondition?: boolean;
  destination: AssetDestination;
  onDestinationChange: (destination: AssetDestination) => void;
  regions: Option[];
  distributors: Option[];
  storeNames: string[];
  disabled: boolean;
}) {
  const storeListId = useId();

  // Region/distributor nonaktif tetap ditampilkan jika sedang dipakai catatan ini.
  const regionOptions = regions.filter((r) => r.is_active || r.id === placement?.region_id);
  const distributorOptions = distributors.filter((d) => d.is_active || d.id === placement?.distributor_id);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Tanggal</Label>
          <DatePicker name="event_date" defaultValue={placement?.event_date ?? todayIso()} disabled={disabled} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-destination">Tujuan</Label>
          <Select
            id="pl-destination"
            name="destination"
            value={destination}
            onChange={(e) => onDestinationChange(e.target.value as AssetDestination)}
            disabled={disabled}
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
                disabled={disabled}
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
                disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
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
            defaultValue={keepCondition ? ASSET_KEEP_CONDITION : (placement?.condition ?? defaultCondition)}
            disabled={disabled}
          >
            {keepCondition && <option value={ASSET_KEEP_CONDITION}>Pertahankan kondisi masing-masing</option>}
            {ASSET_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-pic">PIC / Penerima (opsional)</Label>
          <Input id="pl-pic" name="pic_name" defaultValue={placement?.pic_name ?? ""} disabled={disabled} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pl-notes">Keterangan (opsional)</Label>
        <Textarea
          id="pl-notes"
          name="notes"
          defaultValue={placement?.notes ?? ""}
          placeholder="Contoh: ditarik untuk servis, dipindah ke toko baru"
          disabled={disabled}
          className="min-h-[64px]"
        />
      </div>
    </>
  );
}

function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
      <AlertCircle className="h-4 w-4 flex-shrink-0" />
      <span>{error}</span>
    </div>
  );
}

function FormFooter({ onCancel, isPending }: { onCancel: () => void; isPending: boolean }) {
  return (
    <DialogFooter className="pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
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
  );
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

          <FormError error={state.error} />

          <PlacementFields
            placement={placement}
            defaultCondition={defaultCondition}
            destination={destination}
            onDestinationChange={setDestination}
            regions={regions}
            distributors={distributors}
            storeNames={storeNames}
            disabled={isPending}
          />

          <PhotoField
            label="Foto Bukti (opsional)"
            currentUrl={placement?.photo_url ?? null}
            value={photo.change}
            onChange={photo.setChange}
            disabled={isPending}
          />

          <FormFooter onCancel={() => setOpen(false)} isPending={isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Pindahkan (N)": satu catatan penempatan per asset terpilih, dengan isian
 * yang sama untuk semuanya, disimpan dalam satu transaksi.
 */
export function BulkPlacementDialog({
  assets,
  regions,
  distributors,
  storeNames,
  onMoved,
  trigger,
}: {
  assets: { id: string; code: string }[];
  regions: Option[];
  distributors: Option[];
  storeNames: string[];
  onMoved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<AssetDestination>("placed");
  const photo = usePhotoChange("placement");
  const [state, formAction, isPending] = useActionState(
    async (prev: MoveMarketingAssetsBulkState, formData: FormData) => {
      const result = await moveMarketingAssetsBulkAction(prev, formData);
      if (result.success) {
        await photo.save(result.ids);
        toast.success(`${result.ids?.length ?? assets.length} asset dipindahkan`);
        setOpen(false);
        onMoved();
      }
      return result;
    },
    {}
  );

  const codes = assets.map((a) => a.code);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDestination("placed");
          photo.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pindahkan {assets.length} Asset</DialogTitle>
          <p className="text-sm text-slate-400">
            {codes.slice(0, 5).join(", ")}
            {codes.length > 5 && ` dan ${codes.length - 5} lainnya`}
          </p>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {assets.map((a) => (
            <input key={a.id} type="hidden" name="asset_id" value={a.id} />
          ))}

          <FormError error={state.error} />

          <PlacementFields
            placement={null}
            defaultCondition="Baik"
            keepCondition
            destination={destination}
            onDestinationChange={setDestination}
            regions={regions}
            distributors={distributors}
            storeNames={storeNames}
            disabled={isPending}
          />

          <PhotoField
            label="Foto Bukti (opsional, untuk semua asset)"
            currentUrl={null}
            value={photo.change}
            onChange={photo.setChange}
            disabled={isPending}
          />

          <FormFooter onCancel={() => setOpen(false)} isPending={isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

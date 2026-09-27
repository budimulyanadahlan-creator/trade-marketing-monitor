"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deleteGimmickMovementAction,
  saveGimmickMovementAction,
  type SaveGimmickMovementState,
} from "@/app/actions/gimmick";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { AlertCircle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDate, formatIDR } from "@/lib/utils";
import {
  formatPcsWithCartons,
  GIMMICK_DESTINATION_LABELS,
  GIMMICK_DESTINATIONS,
  GIMMICK_MOVEMENT_TYPES,
  pcsToCartons,
} from "@/lib/gimmick";
import { POSM_MOVEMENT_LABELS, type AdjustmentDirection } from "@/lib/posm";
import type { GimmickDestination, GimmickMovementRow, PosmMovementType } from "@/types/database";
import { MovementDestination } from "../../../movement-destination";
import { SkpPicker } from "../../../skp-picker";
import { PhotoField, PhotoThumb, usePhotoChange } from "../../../posm-photo";

export type GimmickMovementListRow = Pick<
  GimmickMovementRow,
  | "id"
  | "movement_date"
  | "type"
  | "quantity"
  | "unit_cost_snapshot"
  | "destination"
  | "region_id"
  | "distributor_id"
  | "campaign_id"
  | "recipient_name"
  | "notes"
  | "created_at"
> & {
  region_name: string | null;
  distributor_name: string | null;
  campaign_skp: string | null;
  campaign_name: string | null;
  creator_name: string | null;
  running_balance: number;
  /** qty × harga snapshot (bertanda). */
  value: number;
  /** Signed URL foto bukti serah terima (hanya Keluar). */
  photo_url: string | null;
};

export type GimmickItemInfo = {
  id: string;
  code: string;
  name: string;
  unit: string;
  pcs_per_carton: number | null;
  is_active: boolean;
};

export type RegionOption = { id: string; name: string; is_active: boolean };
export type DistributorOption = { id: string; name: string; is_active: boolean };

type GimmickMovementType = (typeof GIMMICK_MOVEMENT_TYPES)[number];

const TYPE_BADGE: Record<PosmMovementType, "default" | "secondary" | "warning" | "outline"> = {
  opening: "secondary",
  in: "default",
  out: "outline",
  adjustment: "warning",
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatQty(qty: number, item: GimmickItemInfo) {
  return `${qty > 0 ? "+" : ""}${formatPcsWithCartons(qty, item.pcs_per_carton, item.unit)}`;
}

// ---- Add / Edit Dialog ----
// Qty diisi karton + pcs dan dikonversi ke pcs di server memakai isi/karton
// item. Saat edit, item boleh diganti (harga snapshot diambil ulang di
// database); pilihan item: item aktif ditambah item mutasi ini.

// Label & placeholder keterangan: wajib untuk Penyesuaian dan Keluar selain
// Region/Distributor (sama dengan gimmickDestination di lib/gimmick.ts).
function notesField(type: PosmMovementType, destination: GimmickDestination | "") {
  if (type === "adjustment")
    return { label: "Alasan", placeholder: "Contoh: rusak, hilang, hasil stock opname", required: true };
  if (type === "out" && destination === "event")
    return { label: "Nama Event", placeholder: "Contoh: Pameran JIExpo 2026", required: true };
  if (type === "out" && destination === "internal")
    return { label: "Keperluan Internal", placeholder: "Untuk siapa / keperluan apa", required: true };
  if (type === "out" && destination === "other")
    return { label: "Keterangan", placeholder: "Jelaskan tujuan pengeluaran", required: true };
  return { label: "Keterangan (opsional)", placeholder: "", required: false };
}

// Field tujuan Keluar ditampilkan sesuai tujuan: region wajib untuk
// Region/Distributor dan opsional untuk Event; distributor hanya untuk
// Region/Distributor; SKP dan PIC opsional untuk semua tujuan.
function OutDestinationFields({
  destination,
  onDestinationChange,
  movement,
  regions,
  distributors,
  disabled,
}: {
  destination: GimmickDestination | "";
  onDestinationChange: (value: GimmickDestination | "") => void;
  movement: GimmickMovementListRow | null;
  regions: RegionOption[];
  distributors: DistributorOption[];
  disabled: boolean;
}) {
  // Region/distributor nonaktif tetap ditampilkan jika sedang dipakai mutasi ini.
  const regionOptions = regions.filter((r) => r.is_active || r.id === movement?.region_id);
  const distributorOptions = distributors.filter((d) => d.is_active || d.id === movement?.distributor_id);
  const showRegion = destination === "region_distributor" || destination === "event";

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gmv-destination">Tujuan</Label>
          <Select
            id="gmv-destination"
            name="destination"
            value={destination}
            onChange={(e) => onDestinationChange(e.target.value as GimmickDestination | "")}
            placeholder="Pilih tujuan"
            required
            disabled={disabled}
          >
            {GIMMICK_DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {GIMMICK_DESTINATION_LABELS[d]}
              </option>
            ))}
          </Select>
        </div>
        {showRegion && (
          <div className="space-y-1.5">
            <Label htmlFor="gmv-region">
              {destination === "region_distributor" ? "Region Tujuan" : "Region (opsional)"}
            </Label>
            <Select
              id="gmv-region"
              name="region_id"
              defaultValue={movement?.region_id ?? ""}
              placeholder={destination === "region_distributor" ? "Pilih region" : undefined}
              required={destination === "region_distributor"}
              disabled={disabled}
            >
              {destination === "event" && <option value="">Tanpa region</option>}
              {regionOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {destination === "region_distributor" && (
        <div className="space-y-1.5">
          <Label htmlFor="gmv-distributor">Distributor (opsional)</Label>
          <Select
            id="gmv-distributor"
            name="distributor_id"
            defaultValue={movement?.distributor_id ?? ""}
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
      )}

      <div className="space-y-1.5">
        <Label htmlFor="gmv-recipient">PIC / Penerima (opsional)</Label>
        <Input
          id="gmv-recipient"
          name="recipient_name"
          defaultValue={movement?.recipient_name ?? ""}
          maxLength={100}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label>SKP Terkait (opsional)</Label>
        <SkpPicker
          name="campaign_id"
          defaultValue={
            movement?.campaign_id
              ? { id: movement.campaign_id, skp_number: movement.campaign_skp, name: movement.campaign_name ?? "" }
              : null
          }
          disabled={disabled}
        />
      </div>
    </>
  );
}

function MovementDialog({
  item,
  items,
  movement,
  regions,
  distributors,
  trigger,
}: {
  item: GimmickItemInfo;
  items: GimmickItemInfo[];
  movement: GimmickMovementListRow | null;
  regions: RegionOption[];
  distributors: DistributorOption[];
  trigger: React.ReactNode;
}) {
  const isEdit = movement !== null;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PosmMovementType>(movement?.type ?? "in");
  const [destination, setDestination] = useState<GimmickDestination | "">(movement?.destination ?? "");
  const [itemId, setItemId] = useState(item.id);
  const photo = usePhotoChange("gimmick_movement");
  const [state, formAction, isPending] = useActionState(
    async (prev: SaveGimmickMovementState, formData: FormData) => {
      const result = await saveGimmickMovementAction(prev, formData);
      if (result.success) {
        // Foto bukti hanya untuk Keluar; tipe lain dibersihkan oleh server.
        if (formData.get("type") === "out") await photo.save(result.id);
        toast.success(isEdit ? "Mutasi diperbarui" : "Mutasi dicatat");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  const itemOptions = items.filter((i) => i.is_active || i.id === item.id);
  const selected = itemOptions.find((i) => i.id === itemId) ?? item;
  const perCarton = selected.pcs_per_carton;

  // Nilai awal edit: pecah qty tersimpan ke karton + sisa pcs item asal.
  const initial =
    movement && item.pcs_per_carton
      ? pcsToCartons(movement.quantity, item.pcs_per_carton)
      : { cartons: 0, pcs: movement ? Math.abs(movement.quantity) : 0 };
  const defaultDirection: AdjustmentDirection = movement && movement.quantity < 0 ? "minus" : "plus";
  const notes = notesField(type, destination);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setType(movement?.type ?? "in");
          setDestination(movement?.destination ?? "");
          setItemId(item.id);
          photo.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Mutasi" : "Catat Mutasi"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {movement && <input type="hidden" name="id" value={movement.id} />}
          {!isEdit && <input type="hidden" name="item_id" value={item.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          {isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="gmv-item">Item</Label>
              <Select
                id="gmv-item"
                name="item_id"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                disabled={isPending}
              >
                {itemOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </Select>
              {itemId !== item.id && (
                <p className="text-xs text-amber-400">
                  Harga pokok transaksi akan diambil ulang dari harga item yang baru.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gmv-type">Tipe</Label>
              <Select
                id="gmv-type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as GimmickMovementType)}
                disabled={isPending}
              >
                {GIMMICK_MOVEMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {POSM_MOVEMENT_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tanggal</Label>
              <DatePicker
                name="movement_date"
                defaultValue={movement?.movement_date ?? todayIso()}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {perCarton && (
              <div className="space-y-1.5">
                <Label htmlFor="gmv-cartons">Karton (isi {perCarton})</Label>
                <Input
                  id="gmv-cartons"
                  name="cartons"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={initial.cartons || ""}
                  placeholder="0"
                  disabled={isPending}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="gmv-pcs">{perCarton ? `+ ${selected.unit}` : `Qty (${selected.unit})`}</Label>
              <Input
                id="gmv-pcs"
                name="pcs"
                type="number"
                min={0}
                step={1}
                defaultValue={initial.pcs || ""}
                placeholder="0"
                disabled={isPending}
              />
            </div>
            {type === "adjustment" && (
              <div className="space-y-1.5">
                <Label htmlFor="gmv-direction">Arah</Label>
                <Select id="gmv-direction" name="direction" defaultValue={defaultDirection} disabled={isPending}>
                  <option value="plus">Tambah (+)</option>
                  <option value="minus">Kurang (−)</option>
                </Select>
              </div>
            )}
          </div>

          {type === "out" && (
            <>
              <OutDestinationFields
                destination={destination}
                onDestinationChange={setDestination}
                movement={movement}
                regions={regions}
                distributors={distributors}
                disabled={isPending}
              />
              <PhotoField
                label="Foto Bukti Serah Terima (opsional)"
                currentUrl={movement?.photo_url ?? null}
                value={photo.change}
                onChange={photo.setChange}
                disabled={isPending}
              />
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="gmv-notes">{notes.label}</Label>
            <Textarea
              id="gmv-notes"
              name="notes"
              defaultValue={movement?.notes ?? ""}
              placeholder={notes.placeholder}
              required={notes.required}
              disabled={isPending}
              className="min-h-[64px]"
            />
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

// ---- Delete Button ----

function DeleteMovementButton({ movement, item }: { movement: GimmickMovementListRow; item: GimmickItemInfo }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteGimmickMovementAction(movement.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Mutasi dihapus");
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50">
          <Trash2 className="h-3 w-3" />
          Hapus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Mutasi</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Hapus mutasi{" "}
          <span className="font-medium text-slate-200">
            {POSM_MOVEMENT_LABELS[movement.type]} {formatQty(movement.quantity, item)}
          </span>{" "}
          tanggal {formatDate(movement.movement_date)}? Saldo akan dihitung ulang.
        </p>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Batal
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Panel ----
// Hanya dirender untuk pemegang can_manage_posm(), jadi aksi tulis selalu tampil.

export function GimmickMovementsPanel({
  item,
  items,
  movements,
  regions,
  distributors,
}: {
  item: GimmickItemInfo;
  items: GimmickItemInfo[];
  movements: GimmickMovementListRow[];
  regions: RegionOption[];
  distributors: DistributorOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Riwayat Mutasi</h2>
        {item.is_active ? (
          <MovementDialog
            item={item}
            items={items}
            movement={null}
            regions={regions}
            distributors={distributors}
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" />
                Catat Mutasi
              </Button>
            }
          />
        ) : (
          <p className="text-xs text-slate-500">Aktifkan item untuk mencatat mutasi baru.</p>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Tanggal</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Harga Pokok</TableHead>
              <TableHead className="text-right">Nilai</TableHead>
              <TableHead>Tujuan</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Dicatat Oleh</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length > 0 ? (
              movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-slate-300">{formatDate(m.movement_date)}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_BADGE[m.type]}>{POSM_MOVEMENT_LABELS[m.type]}</Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium tabular-nums whitespace-nowrap",
                      m.quantity > 0 ? "text-emerald-400" : "text-rose-400"
                    )}
                  >
                    {formatQty(m.quantity, item)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-100">
                    {m.running_balance.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-400">
                    {formatIDR(m.unit_cost_snapshot)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums whitespace-nowrap",
                      m.value < 0 ? "text-rose-400" : "text-slate-100"
                    )}
                  >
                    {formatIDR(m.value)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <PhotoThumb url={m.photo_url} alt={`Bukti serah terima ${formatDate(m.movement_date)}`} />
                      <MovementDestination
                        destinationLabel={m.destination ? GIMMICK_DESTINATION_LABELS[m.destination] : null}
                        regionName={m.region_name}
                        distributorName={m.distributor_name}
                        recipientName={m.recipient_name}
                        campaignSkp={m.campaign_skp}
                        campaignName={m.campaign_name}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs text-slate-400">{m.notes ?? "—"}</TableCell>
                  <TableCell className="text-slate-500">{m.creator_name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <MovementDialog
                        item={item}
                        items={items}
                        movement={m}
                        regions={regions}
                        distributors={distributors}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      <DeleteMovementButton movement={m} item={item} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                  {item.is_active
                    ? "Belum ada mutasi. Catat Saldo Awal untuk stok yang sudah ada."
                    : "Belum ada mutasi."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

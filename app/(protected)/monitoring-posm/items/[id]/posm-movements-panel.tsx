"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deletePosmMovementAction,
  savePosmMovementAction,
  type SavePosmMovementState,
} from "@/app/actions/posm";
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
import { cn, formatDate } from "@/lib/utils";
import { POSM_MOVEMENT_LABELS, POSM_MOVEMENT_TYPES, type AdjustmentDirection } from "@/lib/posm";
import type { PosmMovementRow, PosmMovementType } from "@/types/database";
import { MovementDestination } from "../../movement-destination";
import { SkpPicker } from "../../skp-picker";

export type PosmMovementListRow = Pick<
  PosmMovementRow,
  "id" | "movement_date" | "type" | "quantity" | "region_id" | "distributor_id" | "campaign_id" | "notes" | "created_at"
> & {
  region_name: string | null;
  distributor_name: string | null;
  campaign_skp: string | null;
  campaign_name: string | null;
  creator_name: string | null;
  running_balance: number;
};

type RegionOption = { id: string; name: string; is_active: boolean };
type DistributorOption = { id: string; name: string; is_active: boolean };
type ItemInfo = { id: string; unit: string; is_active: boolean };

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

function formatQty(qty: number) {
  return `${qty > 0 ? "+" : ""}${qty.toLocaleString("id-ID")}`;
}

// ---- Add / Edit Dialog ----

function MovementDialog({
  item,
  movement,
  regions,
  distributors,
  trigger,
}: {
  item: ItemInfo;
  movement: PosmMovementListRow | null;
  regions: RegionOption[];
  distributors: DistributorOption[];
  trigger: React.ReactNode;
}) {
  const isEdit = movement !== null;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PosmMovementType>(movement?.type ?? "in");
  const [state, formAction, isPending] = useActionState(
    async (prev: SavePosmMovementState, formData: FormData) => {
      const result = await savePosmMovementAction(prev, formData);
      if (result.success) {
        toast.success(isEdit ? "Mutasi diperbarui" : "Mutasi dicatat");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  const defaultDirection: AdjustmentDirection = movement && movement.quantity < 0 ? "minus" : "plus";
  // Region nonaktif tetap ditampilkan jika sedang dipakai mutasi ini.
  const regionOptions = regions.filter((r) => r.is_active || r.id === movement?.region_id);
  const distributorOptions = distributors.filter((d) => d.is_active || d.id === movement?.distributor_id);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setType(movement?.type ?? "in");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Mutasi" : "Catat Mutasi"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="item_id" value={item.id} />
          {movement && <input type="hidden" name="id" value={movement.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv-type">Tipe</Label>
              <Select
                id="mv-type"
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as PosmMovementType)}
                disabled={isPending}
              >
                {POSM_MOVEMENT_TYPES.map((t) => (
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
            <div className="space-y-1.5">
              <Label htmlFor="mv-qty">Qty ({item.unit})</Label>
              <Input
                id="mv-qty"
                name="quantity"
                type="number"
                min={1}
                step={1}
                defaultValue={movement ? Math.abs(movement.quantity) : ""}
                required
                disabled={isPending}
              />
            </div>
            {type === "adjustment" && (
              <div className="space-y-1.5">
                <Label htmlFor="mv-direction">Arah</Label>
                <Select id="mv-direction" name="direction" defaultValue={defaultDirection} disabled={isPending}>
                  <option value="plus">Tambah (+)</option>
                  <option value="minus">Kurang (−)</option>
                </Select>
              </div>
            )}
            {type === "out" && (
              <div className="space-y-1.5">
                <Label htmlFor="mv-region">Region Tujuan</Label>
                <Select
                  id="mv-region"
                  name="region_id"
                  defaultValue={movement?.region_id ?? ""}
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
            )}
          </div>

          {type === "out" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mv-distributor">Distributor (opsional)</Label>
                <Select
                  id="mv-distributor"
                  name="distributor_id"
                  defaultValue={movement?.distributor_id ?? ""}
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
              <div className="space-y-1.5">
                <Label>SKP Terkait (opsional)</Label>
                <SkpPicker
                  name="campaign_id"
                  defaultValue={
                    movement?.campaign_id
                      ? {
                          id: movement.campaign_id,
                          skp_number: movement.campaign_skp,
                          name: movement.campaign_name ?? "",
                        }
                      : null
                  }
                  disabled={isPending}
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="mv-notes">{type === "adjustment" ? "Alasan" : "Keterangan (opsional)"}</Label>
            <Textarea
              id="mv-notes"
              name="notes"
              defaultValue={movement?.notes ?? ""}
              placeholder={
                type === "adjustment"
                  ? "Contoh: rusak, hilang, hasil stock opname"
                  : type === "in"
                    ? "Contoh: dari percetakan / supplier"
                    : ""
              }
              required={type === "adjustment"}
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

function DeleteMovementButton({ movement, unit }: { movement: PosmMovementListRow; unit: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePosmMovementAction(movement.id);
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
            {POSM_MOVEMENT_LABELS[movement.type]} {formatQty(movement.quantity)} {unit}
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

export function PosmMovementsPanel({
  item,
  movements,
  regions,
  distributors,
  canManage,
}: {
  item: ItemInfo;
  movements: PosmMovementListRow[];
  regions: RegionOption[];
  distributors: DistributorOption[];
  canManage: boolean;
}) {
  const colSpan = canManage ? 8 : 7;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Riwayat Mutasi</h2>
        {canManage &&
          (item.is_active ? (
            <MovementDialog
              item={item}
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
          ))}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Tanggal</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Tujuan</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Dicatat Oleh</TableHead>
              {canManage && <TableHead className="text-right">Aksi</TableHead>}
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
                      "text-right font-medium tabular-nums",
                      m.quantity > 0 ? "text-emerald-400" : "text-rose-400"
                    )}
                  >
                    {formatQty(m.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-100">
                    {m.running_balance.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell>
                    <MovementDestination
                      regionName={m.region_name}
                      distributorName={m.distributor_name}
                      campaignSkp={m.campaign_skp}
                      campaignName={m.campaign_name}
                    />
                  </TableCell>
                  <TableCell className="max-w-xs text-slate-400">{m.notes ?? "—"}</TableCell>
                  <TableCell className="text-slate-500">{m.creator_name ?? "—"}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <MovementDialog
                          item={item}
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
                        <DeleteMovementButton movement={m} unit={item.unit} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-slate-500">
                  {canManage && item.is_active
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

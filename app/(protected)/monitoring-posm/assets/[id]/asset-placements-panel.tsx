"use client";

import { useState, useTransition } from "react";
import { deleteAssetPlacementAction } from "@/app/actions/posm";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowRight, ArrowRightLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { AssetCondition } from "@/types/database";
import { AssetConditionBadge, AssetLocation } from "../../assets-table";
import { PlacementDialog, type PlacementFormValues } from "../../placement-dialog";
import { PhotoThumb } from "../../posm-photo";

type PlacementLocation = Pick<PlacementFormValues, "destination" | "store_name"> & {
  region_name: string | null;
  distributor_name: string | null;
};

export type AssetPlacementListRow = PlacementFormValues &
  PlacementLocation & {
    created_at: string;
    creator_name: string | null;
    /** Lokasi catatan sebelumnya (asal perpindahan); null untuk pendaftaran. */
    previous: PlacementLocation | null;
  };

type Option = { id: string; name: string; is_active: boolean };

// ---- Delete Button ----

function DeletePlacementButton({ placement }: { placement: AssetPlacementListRow }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAssetPlacementAction(placement.id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Catatan penempatan dihapus");
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
          <DialogTitle>Hapus Catatan Penempatan</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Hapus catatan tanggal{" "}
          <span className="font-medium text-slate-200">{formatDate(placement.event_date)}</span>? Lokasi dan kondisi
          terkini asset akan dihitung ulang dari catatan sebelumnya.
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

export function AssetPlacementsPanel({
  asset,
  placements,
  regions,
  distributors,
  storeNames,
  canManage,
}: {
  asset: { id: string; label: string; condition: AssetCondition };
  /** Urut terbaru lebih dulu. */
  placements: AssetPlacementListRow[];
  regions: Option[];
  distributors: Option[];
  storeNames: string[];
  canManage: boolean;
}) {
  const dialogProps = { assetId: asset.id, assetLabel: asset.label, regions, distributors, storeNames };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">Riwayat Penempatan</h2>
        {canManage && (
          <PlacementDialog
            {...dialogProps}
            placement={null}
            defaultCondition={asset.condition}
            trigger={
              <Button size="sm">
                <ArrowRightLeft className="h-4 w-4" />
                Pindahkan Asset
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
              <TableHead>Dari</TableHead>
              <TableHead className="w-6" />
              <TableHead>Ke</TableHead>
              <TableHead>Kondisi</TableHead>
              <TableHead>PIC</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead>Foto</TableHead>
              <TableHead>Dicatat Oleh</TableHead>
              {canManage && <TableHead className="text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {placements.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap text-slate-300">{formatDate(p.event_date)}</TableCell>
                <TableCell>
                  {p.previous ? (
                    <AssetLocation asset={p.previous} />
                  ) : (
                    <Badge variant="secondary">Pendaftaran</Badge>
                  )}
                </TableCell>
                <TableCell className="px-0 text-slate-600">
                  <ArrowRight className="h-4 w-4" />
                </TableCell>
                <TableCell>
                  <AssetLocation asset={p} />
                  {p.store_address && <p className="text-xs text-slate-500">{p.store_address}</p>}
                </TableCell>
                <TableCell>
                  <AssetConditionBadge condition={p.condition} />
                </TableCell>
                <TableCell className="text-slate-300">{p.pic_name ?? "—"}</TableCell>
                <TableCell className="max-w-xs text-slate-400">{p.notes ?? "—"}</TableCell>
                <TableCell>
                  {p.photo_url ? (
                    <PhotoThumb url={p.photo_url} alt={`Foto bukti ${formatDate(p.event_date)}`} />
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-slate-500">{p.creator_name ?? "—"}</TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <PlacementDialog
                        {...dialogProps}
                        placement={p}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                        }
                      />
                      {/* Catatan pendaftaran tidak bisa dihapus selama asset ada. */}
                      {!p.is_registration && <DeletePlacementButton placement={p} />}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

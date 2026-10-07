"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import {
  deleteMarketingAssetAction,
  saveMarketingAssetAction,
  type SaveMarketingAssetState,
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
import { SearchInput } from "@/components/ui/search-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, ArrowRightLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { filterBySearch } from "@/lib/search";
import { ASSET_CONDITIONS, ASSET_DESTINATION_LABELS, ASSET_WRITTEN_OFF } from "@/lib/posm";
import { formatIDR } from "@/lib/utils";
import type { AssetCondition, AssetDestination, MarketingAssetRow } from "@/types/database";
import { PlacementDialog } from "./placement-dialog";
import { PhotoField, PhotoThumb, usePhotoChange } from "./posm-photo";

export type AssetListRow = Pick<
  MarketingAssetRow,
  | "id"
  | "code"
  | "name"
  | "asset_type_id"
  | "brand_id"
  | "serial_number"
  | "acquisition_date"
  | "acquisition_value"
> & {
  /** Nama dari master asset_types. */
  asset_type_name: string;
  brand_name: string | null;
  // Dari catatan penempatan terakhir (view asset_current_status).
  condition: AssetCondition;
  destination: AssetDestination;
  region_id: string | null;
  region_name: string | null;
  distributor_name: string | null;
  store_name: string | null;
  /** Hanya punya catatan pendaftaran, jadi masih boleh dihapus. */
  can_delete: boolean;
  /** Signed URL foto asset, null jika tidak ada. */
  photo_url: string | null;
};

type Option = { id: string; name: string; is_active: boolean };

const CONDITION_VARIANT: Record<AssetCondition, "default" | "warning" | "destructive" | "outline"> = {
  Baik: "default",
  "Rusak Ringan": "warning",
  "Rusak Berat": "destructive",
  Hilang: "destructive",
  Dihapusbukukan: "outline",
};

export function AssetConditionBadge({ condition }: { condition: AssetCondition }) {
  return <Badge variant={CONDITION_VARIANT[condition]}>{condition}</Badge>;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- Add / Edit Dialog ----

function AssetDialog({
  asset,
  assetTypes,
  brands,
  regions,
  distributors,
  suggestedCode,
  trigger,
}: {
  asset: AssetListRow | null;
  assetTypes: Option[];
  brands: Option[];
  regions: Option[];
  distributors: Option[];
  suggestedCode: string;
  trigger: React.ReactNode;
}) {
  const isEdit = asset !== null;
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<AssetDestination>("warehouse");
  const photo = usePhotoChange("asset");
  const [state, formAction, isPending] = useActionState(
    async (prev: SaveMarketingAssetState, formData: FormData) => {
      const result = await saveMarketingAssetAction(prev, formData);
      if (result.success) {
        await photo.save(result.id);
        toast.success(isEdit ? "Asset diperbarui" : "Asset didaftarkan");
        setOpen(false);
      }
      return result;
    },
    {}
  );

  const brandOptions = brands.filter((b) => b.is_active || b.id === asset?.brand_id);
  // Jenis nonaktif tetap bisa dipertahankan oleh asset yang sudah memakainya.
  const typeOptions = assetTypes.filter((t) => t.is_active || t.id === asset?.asset_type_id);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDestination("warehouse");
          photo.reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Asset" : "Daftarkan Asset"}</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {asset && <input type="hidden" name="id" value={asset.id} />}

          {state.error && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="asset-code">Kode</Label>
              <Input
                id="asset-code"
                name="code"
                defaultValue={asset?.code ?? suggestedCode}
                required
                disabled={isPending}
                className="uppercase"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="asset-name">Nama Asset</Label>
              <Input
                id="asset-name"
                name="name"
                defaultValue={asset?.name ?? ""}
                placeholder="Contoh: Cooler Showcase 2 Pintu"
                required
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="asset-type">Jenis</Label>
              <Select
                id="asset-type"
                name="asset_type_id"
                defaultValue={asset?.asset_type_id ?? ""}
                placeholder="Pilih jenis"
                required
                disabled={isPending}
              >
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-brand">Brand (opsional)</Label>
              <Select id="asset-brand" name="brand_id" defaultValue={asset?.brand_id ?? ""} disabled={isPending}>
                <option value="">— Tanpa brand —</option>
                {brandOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="asset-serial">Nomor Seri / Merk (opsional)</Label>
            <Input
              id="asset-serial"
              name="serial_number"
              defaultValue={asset?.serial_number ?? ""}
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tanggal Perolehan</Label>
              <DatePicker
                name="acquisition_date"
                defaultValue={asset?.acquisition_date ?? todayIso()}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-value">Nilai Perolehan (Rp)</Label>
              <Input
                id="asset-value"
                name="acquisition_value"
                type="number"
                min={0}
                step={1}
                defaultValue={asset?.acquisition_value ?? ""}
                required
                disabled={isPending}
              />
            </div>
          </div>

          <PhotoField
            label="Foto Asset (opsional)"
            currentUrl={asset?.photo_url ?? null}
            value={photo.change}
            onChange={photo.setChange}
            disabled={isPending}
          />

          {/* Lokasi awal hanya saat pendaftaran; perpindahan lewat form terpisah. */}
          {!isEdit && (
            <fieldset className="space-y-4 rounded-lg border border-white/8 p-4">
              <legend className="px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                Lokasi Awal
              </legend>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="asset-destination">Lokasi</Label>
                  <Select
                    id="asset-destination"
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
                <div className="space-y-1.5">
                  <Label>Tanggal</Label>
                  <DatePicker name="event_date" defaultValue={todayIso()} disabled={isPending} />
                </div>
              </div>

              {destination === "placed" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="asset-region">Region</Label>
                      <Select
                        id="asset-region"
                        name="region_id"
                        defaultValue=""
                        placeholder="Pilih region"
                        required
                        disabled={isPending}
                      >
                        {regions
                          .filter((r) => r.is_active)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="asset-distributor">Distributor (opsional)</Label>
                      <Select id="asset-distributor" name="distributor_id" defaultValue="" disabled={isPending}>
                        <option value="">Tanpa distributor</option>
                        {distributors
                          .filter((d) => d.is_active)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="asset-store">Nama Toko</Label>
                    <Input id="asset-store" name="store_name" required disabled={isPending} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="asset-address">Alamat (opsional)</Label>
                    <Input id="asset-address" name="store_address" disabled={isPending} />
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="asset-condition">Kondisi</Label>
                  <Select id="asset-condition" name="condition" defaultValue="Baik" disabled={isPending}>
                    {ASSET_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-pic">PIC / Penerima (opsional)</Label>
                  <Input id="asset-pic" name="pic_name" disabled={isPending} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="asset-notes">Keterangan (opsional)</Label>
                <Textarea id="asset-notes" name="notes" disabled={isPending} className="min-h-[64px]" />
              </div>
            </fieldset>
          )}

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

function DeleteAssetButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteMarketingAssetAction(id);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Asset dihapus");
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
          <DialogTitle>Hapus Asset</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">
          Yakin ingin menghapus asset <span className="font-medium text-slate-200">{label}</span>? Hapus hanya
          untuk salah input. Asset yang sudah tidak dipakai cukup diberi kondisi Dihapusbukukan.
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

// ---- Location Cell ----

export function AssetLocation({
  asset,
}: {
  asset: Pick<AssetListRow, "destination" | "store_name" | "region_name" | "distributor_name">;
}) {
  if (asset.destination === "warehouse") return <span className="text-slate-300">Gudang Pusat</span>;
  return (
    <div className="space-y-0.5">
      <p className="text-slate-300">{asset.store_name}</p>
      <p className="text-xs text-slate-500">
        {[asset.region_name, asset.distributor_name].filter(Boolean).join(" • ")}
      </p>
    </div>
  );
}

// ---- Main Table ----

const ALL_CONDITIONS = "all";

/** Filter kondisi: default (kosong) menyembunyikan asset Dihapusbukukan. */
function matchesCondition(condition: AssetCondition, filter: string) {
  if (filter === "") return condition !== ASSET_WRITTEN_OFF;
  return filter === ALL_CONDITIONS || condition === filter;
}

export function AssetsTable({
  assets,
  assetTypes,
  brands,
  regions,
  distributors,
  storeNames,
  canManage,
  suggestedCode,
}: {
  assets: AssetListRow[];
  assetTypes: Option[];
  brands: Option[];
  regions: Option[];
  distributors: Option[];
  storeNames: string[];
  canManage: boolean;
  suggestedCode: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");

  const filtered = useMemo(() => {
    const byFilters = assets.filter(
      (a) =>
        (!typeFilter || a.asset_type_id === typeFilter) &&
        (!brandFilter || a.brand_id === brandFilter) &&
        matchesCondition(a.condition, conditionFilter) &&
        (!regionFilter || a.region_id === regionFilter)
    );
    return filterBySearch(byFilters, query, (a) => [
      a.code,
      a.name,
      a.brand_name,
      a.serial_number,
      a.store_name,
    ]);
  }, [assets, query, typeFilter, brandFilter, conditionFilter, regionFilter]);

  // Hanya brand/region yang dipakai asset yang relevan sebagai filter.
  const usedBrands = useMemo(() => {
    const used = new Set(assets.map((a) => a.brand_id));
    return brands.filter((b) => used.has(b.id));
  }, [assets, brands]);
  const usedRegions = useMemo(() => {
    const used = new Set(assets.map((a) => a.region_id));
    return regions.filter((r) => used.has(r.id));
  }, [assets, regions]);

  const hasFilter =
    query.trim() !== "" || typeFilter !== "" || brandFilter !== "" || conditionFilter !== "" || regionFilter !== "";
  const hiddenWrittenOff =
    conditionFilter === "" ? assets.filter((a) => a.condition === ASSET_WRITTEN_OFF).length : 0;
  const colSpan = canManage ? 8 : 7;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-400">
          {filtered.length} asset
          {hiddenWrittenOff > 0 && (
            <span className="text-slate-600"> • {hiddenWrittenOff} {ASSET_WRITTEN_OFF.toLowerCase()} disembunyikan</span>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Cari kode, nama, toko..."
            className="w-64"
          />
          <Select
            aria-label="Filter jenis"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 w-40"
          >
            <option value="">Semua jenis</option>
            {assetTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="h-9 w-36"
          >
            <option value="">Semua brand</option>
            {usedBrands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter kondisi"
            value={conditionFilter}
            onChange={(e) => setConditionFilter(e.target.value)}
            className="h-9 w-48"
          >
            <option value="">Tanpa {ASSET_WRITTEN_OFF}</option>
            <option value={ALL_CONDITIONS}>Semua kondisi</option>
            {ASSET_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter region"
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="h-9 w-36"
          >
            <option value="">Semua region</option>
            {usedRegions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          {canManage && (
            <AssetDialog
              asset={null}
              assetTypes={assetTypes}
              brands={brands}
              regions={regions}
              distributors={distributors}
              suggestedCode={suggestedCode}
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Daftarkan Asset
                </Button>
              }
            />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/8 hover:bg-transparent">
              <TableHead>Kode</TableHead>
              <TableHead>Nama Asset</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Kondisi</TableHead>
              <TableHead>Lokasi Terkini</TableHead>
              <TableHead className="text-right">Nilai Perolehan</TableHead>
              {canManage && <TableHead className="text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell>
                    <code className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-300">{asset.code}</code>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <PhotoThumb url={asset.photo_url} alt={`${asset.code} — ${asset.name}`} />
                      <div>
                        <Link
                          href={`/monitoring-posm/assets/${asset.id}`}
                          className="hover:text-emerald-400 hover:underline"
                        >
                          {asset.name}
                        </Link>
                        {asset.serial_number && <p className="text-xs text-slate-500">{asset.serial_number}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-300">{asset.asset_type_name}</TableCell>
                  <TableCell className="text-slate-400">{asset.brand_name ?? "—"}</TableCell>
                  <TableCell>
                    <AssetConditionBadge condition={asset.condition} />
                  </TableCell>
                  <TableCell>
                    <AssetLocation asset={asset} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-100 whitespace-nowrap">
                    {formatIDR(Number(asset.acquisition_value))}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <AssetDialog
                          asset={asset}
                          assetTypes={assetTypes}
                          brands={brands}
                          regions={regions}
                          distributors={distributors}
                          suggestedCode={suggestedCode}
                          trigger={
                            <Button variant="outline" size="sm">
                              <Pencil className="h-3 w-3" />
                              Edit
                            </Button>
                          }
                        />
                        <PlacementDialog
                          assetId={asset.id}
                          assetLabel={`${asset.code} — ${asset.name}`}
                          placement={null}
                          defaultCondition={asset.condition}
                          regions={regions}
                          distributors={distributors}
                          storeNames={storeNames}
                          trigger={
                            <Button variant="outline" size="sm">
                              <ArrowRightLeft className="h-3 w-3" />
                              Pindahkan
                            </Button>
                          }
                        />
                        {/* Asset dengan riwayat perpindahan tidak bisa dihapus. */}
                        {asset.can_delete && (
                          <DeleteAssetButton id={asset.id} label={`${asset.code} — ${asset.name}`} />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-slate-500">
                  {hasFilter
                    ? "Tidak ada asset yang cocok dengan filter."
                    : canManage
                      ? "Belum ada asset. Daftarkan asset pertama Anda."
                      : "Belum ada asset."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

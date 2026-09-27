"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, ImagePlus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { POSM_PHOTO_ACCEPT, POSM_PHOTO_MAX_LABEL, validatePosmPhoto, type PosmPhotoKind } from "@/lib/posm-photo";

// ---- Thumbnail yang bisa diperbesar ----

export function PhotoThumb({
  url,
  alt,
  className,
}: {
  url: string | null;
  alt: string;
  className?: string;
}) {
  if (!url) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title="Perbesar foto"
          className={cn(
            "flex-shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5 hover:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500",
            className ?? "h-9 w-9"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase, bukan aset statis */}
          <img src={url} alt={alt} className="h-full w-full object-cover" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{alt}</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase, bukan aset statis */}
        <img src={url} alt={alt} className="max-h-[75vh] w-full rounded-md object-contain" />
      </DialogContent>
    </Dialog>
  );
}

// ---- Field foto di dalam form ----

/** Perubahan foto yang dipilih di form: file baru, hapus foto lama, atau tidak ada. */
export type PhotoChange = { file: File | null; remove: boolean };

const NO_CHANGE: PhotoChange = { file: null, remove: false };

/**
 * Input file sengaja tanpa atribut name agar foto tidak ikut terkirim ke
 * server action (batas body server action kecil); foto diupload terpisah
 * lewat /api/posm-photo setelah data tersimpan.
 */
export function PhotoField({
  currentUrl,
  value,
  onChange,
  disabled,
  label = "Foto (opsional)",
}: {
  currentUrl: string | null;
  value: PhotoChange;
  onChange: (change: PhotoChange) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file]);
  useEffect(() => {
    if (previewUrl) return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const shownUrl = previewUrl ?? (value.remove ? null : currentUrl);

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const invalid = validatePosmPhoto(file);
    setError(invalid);
    if (!invalid) onChange({ file, remove: false });
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/5">
          {shownUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal / signed URL
            <img src={shownUrl} alt="Pratinjau foto" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-5 w-5 text-slate-600" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={POSM_PHOTO_ACCEPT}
            className="hidden"
            aria-label="Pilih foto"
            onChange={handleSelect}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <ImagePlus className="h-3 w-3" />
            {shownUrl ? "Ganti Foto" : "Pilih Foto"}
          </Button>
          {value.file || value.remove ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                onChange(NO_CHANGE);
              }}
              disabled={disabled}
            >
              <Undo2 className="h-3 w-3" />
              Batalkan
            </Button>
          ) : (
            currentUrl && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-rose-400 hover:text-rose-300 hover:border-rose-500/50"
                onClick={() => onChange({ file: null, remove: true })}
                disabled={disabled}
              >
                <Trash2 className="h-3 w-3" />
                Hapus Foto
              </Button>
            )
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        {value.remove ? "Foto akan dihapus saat disimpan." : `JPG atau PNG, maksimal ${POSM_PHOTO_MAX_LABEL}.`}
      </p>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

// ---- Simpan perubahan foto setelah data tersimpan ----

async function applyPhotoChange(kind: PosmPhotoKind, id: string, change: PhotoChange): Promise<string | null> {
  let res: Response;
  if (change.file) {
    const body = new FormData();
    body.set("kind", kind);
    body.set("id", id);
    body.set("file", change.file);
    res = await fetch("/api/posm-photo", { method: "POST", body });
  } else if (change.remove) {
    res = await fetch("/api/posm-photo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id }),
    });
  } else {
    return null;
  }
  if (res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? "Gagal menyimpan foto.";
}

/**
 * State field foto + fungsi untuk menyimpannya setelah server action
 * berhasil. Kegagalan foto tidak membatalkan data yang sudah tersimpan.
 */
export function usePhotoChange(kind: PosmPhotoKind) {
  const router = useRouter();
  const [change, setChange] = useState<PhotoChange>(NO_CHANGE);

  async function save(id: string | undefined) {
    if (!id || (!change.file && !change.remove)) return;
    const error = await applyPhotoChange(kind, id, change);
    if (error) toast.error(`Data tersimpan, tetapi foto gagal disimpan: ${error}`);
    router.refresh();
  }

  return { change, setChange, reset: () => setChange(NO_CHANGE), save };
}

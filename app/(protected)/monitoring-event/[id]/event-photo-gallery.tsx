"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EVENT_PHOTO_MAX, eventPhotoLimitError } from "@/lib/event";
import { POSM_PHOTO_ACCEPT, POSM_PHOTO_MAX_LABEL, validatePosmPhoto } from "@/lib/posm-photo";
import { PhotoThumb } from "../../monitoring-posm/posm-photo";

export type EventPhotoItem = { id: string; url: string | null };

async function responseError(res: Response, fallback: string) {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? fallback;
}

function DeletePhotoButton({ photoId, onDeleted }: { photoId: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await fetch("/api/event-photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: photoId }),
      });
      if (!res.ok) {
        toast.error(await responseError(res, "Gagal menghapus foto."));
        return;
      }
      toast.success("Foto dihapus");
      setOpen(false);
      onDeleted();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="destructive"
          size="icon"
          className="absolute right-1.5 top-1.5 h-7 w-7 opacity-90"
          aria-label="Hapus foto"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hapus Foto</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400">Yakin ingin menghapus foto ini? Penghapusan tercatat di audit log.</p>
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

/**
 * Galeri foto dokumentasi event (maks. EVENT_PHOTO_MAX). Semua viewer yang
 * boleh melihat event bisa memperbesar foto (signed URL); upload/hapus hanya
 * untuk pemegang can_manage_posm(). Foto tidak wajib untuk status apa pun.
 * Foto dikirim satu per satu ke /api/event-photo, yang mengompresnya.
 */
export function EventPhotoGallery({
  eventId,
  eventName,
  photos,
  canManage,
}: {
  eventId: string;
  eventName: string;
  photos: EventPhotoItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const full = photos.length >= EVENT_PHOTO_MAX;

  async function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const limitError = eventPhotoLimitError(photos.length, files.length);
    if (limitError) {
      toast.error(limitError);
      return;
    }
    for (const file of files) {
      const invalid = validatePosmPhoto(file);
      if (invalid) {
        toast.error(`${file.name}: ${invalid}`);
        return;
      }
    }

    let uploaded = 0;
    setUploading({ done: 0, total: files.length });
    try {
      for (const file of files) {
        const body = new FormData();
        body.set("event_id", eventId);
        body.set("file", file);
        const res = await fetch("/api/event-photo", { method: "POST", body });
        if (!res.ok) {
          toast.error(`${file.name}: ${await responseError(res, "Gagal mengunggah foto.")}`);
          break;
        }
        uploaded += 1;
        setUploading({ done: uploaded, total: files.length });
      }
    } finally {
      setUploading(null);
      if (uploaded > 0) {
        toast.success(`${uploaded} foto diunggah`);
        router.refresh();
      }
    }
  }

  return (
    <section className="rounded-xl border border-white/8 bg-white/2 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-300">Foto Dokumentasi</h2>
          <p className="text-xs text-slate-500">
            {photos.length}/{EVENT_PHOTO_MAX} foto
            {canManage && ` • JPG atau PNG, maksimal ${POSM_PHOTO_MAX_LABEL} per foto`}
          </p>
        </div>
        {canManage && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={POSM_PHOTO_ACCEPT}
              multiple
              className="hidden"
              aria-label="Pilih foto"
              onChange={handleSelect}
              disabled={!!uploading || full}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={!!uploading || full}
              title={full ? eventPhotoLimitError(photos.length, 1) ?? undefined : undefined}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {uploading ? `Mengunggah ${uploading.done}/${uploading.total}` : "Unggah Foto"}
            </Button>
          </>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-500">
          <ImageIcon className="h-6 w-6 text-slate-600" />
          Belum ada foto dokumentasi.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {photos.map((p, i) => (
            <li key={p.id} className="relative">
              {p.url ? (
                <PhotoThumb url={p.url} alt={`${eventName} — foto ${i + 1}`} className="aspect-square h-auto w-full" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-md border border-white/10 bg-white/5 text-xs text-slate-500">
                  Foto tidak tersedia
                </div>
              )}
              {canManage && <DeletePhotoButton photoId={p.id} onDeleted={() => router.refresh()} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, PenLine, Upload } from "lucide-react";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

export function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    initCanvas();
  }, [initCanvas]);

  function getCoords(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    e.preventDefault();
    drawing.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    e.preventDefault();
    if (!drawing.current) return;
    hasDrawn.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    e.preventDefault();
    if (!drawing.current) return;
    drawing.current = false;
    if (hasDrawn.current) {
      onChange(canvasRef.current!.toDataURL("image/png"));
    }
  }

  function handleClear() {
    hasDrawn.current = false;
    drawing.current = false;
    initCanvas();
    setUploadPreview(null);
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchMode(next: "draw" | "upload") {
    handleClear();
    setMode(next);
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setUploadPreview(url);
      onChange(url);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      {/* Mode tabs + clear */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => switchMode("draw")}
          className={`flex items-center gap-1 text-xs pb-0.5 border-b transition-colors ${
            mode === "draw"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <PenLine className="h-3 w-3" />
          Gambar
        </button>
        <button
          type="button"
          onClick={() => switchMode("upload")}
          className={`flex items-center gap-1 text-xs pb-0.5 border-b transition-colors ${
            mode === "upload"
              ? "border-emerald-400 text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <Upload className="h-3 w-3" />
          Upload Gambar
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleClear}
          className="ml-auto h-6 px-2 text-xs text-slate-500 hover:text-slate-300"
        >
          <Eraser className="h-3 w-3 mr-1" />
          Hapus
        </Button>
      </div>

      {mode === "draw" ? (
        <>
          <canvas
            ref={canvasRef}
            width={560}
            height={160}
            className="w-full rounded-lg border border-white/10 cursor-crosshair touch-none select-none"
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <p className="text-center text-xs text-slate-600">
            Gambar tanda tangan di area di atas
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 h-24 rounded-lg border border-dashed border-white/15 cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors"
          >
            <Upload className="h-5 w-5 text-slate-500" />
            <p className="text-xs text-slate-500">
              Klik untuk upload gambar tanda tangan
            </p>
            <p className="text-xs text-slate-600">PNG, JPG, WEBP</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
          />
          {uploadPreview && (
            <div className="rounded-lg border border-white/10 bg-white/4 p-2">
              <img
                src={uploadPreview}
                alt="Pratinjau tanda tangan"
                className="max-h-20 mx-auto object-contain"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

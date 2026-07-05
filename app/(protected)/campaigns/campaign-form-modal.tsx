"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Upload,
  X,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { saveDraftCampaignAction, submitCampaignAction } from "@/app/actions/campaigns";
import { formatIDR } from "@/lib/utils";
import type { CampaignFileRow } from "@/types/database";

// ─── Types ─────────────────────────────────────────────────────────────────

interface FormData {
  id?: string;
  // Step 1
  name: string;
  department_id: string;
  brand_id: string;
  region_id: string;
  // Step 2
  channel_id: string;
  promotion_category_id: string;
  action_approval_id: string;
  vendor_id: string;
  store_id: string;
  objective: string;
  mechanism: string;
  // Step 3
  avg_sales_3months: string;
  requested_budget: string;
  sales_projection: string;
  start_date: string;
  end_date: string;
}

interface PendingFile {
  file: File;
  localId: string;
}

interface MasterBudgetInfo {
  id: string;
  promotion_category_id: string;
  fiscal_year: number;
  quarter: number;
  total_amount: number;
}

interface CampaignFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<FormData>;
  existingFiles?: CampaignFileRow[];
  departments: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  categories: { id: string; name: string; type: string; account_code: string }[];
  actionApprovals: { id: string; name: string; brand_id: string | null; start_date: string; end_date: string; target_budget: number }[];
  vendors: { id: string; name: string }[];
  masterBudgets?: MasterBudgetInfo[];
  /** When set, region dropdown is locked to this single region (Sales dept users). */
  lockedRegionId?: string | null;
}

// ─── Step Indicator ────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = ["Info Dasar", "Detail SKP", "Budget & Dokumen"];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : active
                    ? "border-emerald-500 bg-transparent text-emerald-400"
                    : "border-white/15 bg-transparent text-slate-500"
                }`}
              >
                {done ? "✓" : step}
              </div>
              <span
                className={`text-xs font-medium ${
                  active ? "text-emerald-400" : done ? "text-slate-300" : "text-slate-500"
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 mt-[-14px] transition-colors ${
                  done ? "bg-emerald-500/50" : "bg-white/8"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1 ────────────────────────────────────────────────────────────────

function Step1({
  data,
  onChange,
  departments,
  brands,
  regions,
  lockedRegionId,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  departments: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  regions: { id: string; name: string }[];
  lockedRegionId?: string | null;
}) {
  const visibleRegions = lockedRegionId
    ? regions.filter((r) => r.id === lockedRegionId)
    : regions;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-name">Nama SKP *</Label>
        <Input
          id="c-name"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Contoh: SKP Lebaran 2025 — GT Jawa"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-dept">Departemen *</Label>
        <Select
          id="c-dept"
          value={data.department_id}
          onChange={(e) => onChange({ department_id: e.target.value })}
          placeholder="— Pilih Departemen —"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-brand">Brand *</Label>
        <Select
          id="c-brand"
          value={data.brand_id}
          onChange={(e) => onChange({ brand_id: e.target.value })}
          placeholder="— Pilih Brand —"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-region">
          Region *
          {lockedRegionId && (
            <span className="ml-2 text-xs text-slate-500">(terkunci ke region Anda)</span>
          )}
        </Label>
        <Select
          id="c-region"
          value={data.region_id}
          onChange={(e) => onChange({ region_id: e.target.value })}
          placeholder="— Pilih Region —"
          disabled={!!lockedRegionId}
        >
          {visibleRegions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ─── Step 2 ────────────────────────────────────────────────────────────────

const STORE_ID_CATEGORY_CODES = ["TP1", "TP3", "TP4"];

function Step2({
  data,
  onChange,
  channels,
  categories,
  actionApprovals,
  vendors,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  channels: { id: string; name: string }[];
  categories: { id: string; name: string; type: string; account_code: string }[];
  actionApprovals: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
}) {
  const selectedCategory = categories.find((c) => c.id === data.promotion_category_id);
  const showStoreId = selectedCategory
    ? STORE_ID_CATEGORY_CODES.includes(selectedCategory.account_code)
    : false;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="c-channel">Channel *</Label>
        <Select
          id="c-channel"
          value={data.channel_id}
          onChange={(e) => onChange({ channel_id: e.target.value })}
          placeholder="— Pilih Channel —"
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-cat">Kategori Promosi *</Label>
        <Select
          id="c-cat"
          value={data.promotion_category_id}
          onChange={(e) => onChange({ promotion_category_id: e.target.value })}
          placeholder="— Pilih Kategori Promosi —"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.account_code}] {c.name}
            </option>
          ))}
        </Select>
      </div>

      {showStoreId && (
        <div className="space-y-1.5">
          <Label htmlFor="c-store-id">
            ID Store
            <span className="ml-2 text-xs text-slate-500">(opsional)</span>
          </Label>
          <Input
            id="c-store-id"
            value={data.store_id}
            onChange={(e) => onChange({ store_id: e.target.value })}
            placeholder="Contoh: STR-001"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="c-prog">Action Approval (AA)</Label>
        <Select
          id="c-prog"
          value={data.action_approval_id}
          onChange={(e) => onChange({ action_approval_id: e.target.value })}
        >
          <option value="">— Pilih AA (opsional) —</option>
          {actionApprovals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-vendor">Vendor</Label>
        <Select
          id="c-vendor"
          value={data.vendor_id}
          onChange={(e) => onChange({ vendor_id: e.target.value })}
        >
          <option value="">— Pilih Vendor (opsional) —</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-obj">Objective</Label>
        <Textarea
          id="c-obj"
          value={data.objective}
          onChange={(e) => onChange({ objective: e.target.value })}
          placeholder="Deskripsikan tujuan campaign..."
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-mech">Mekanisme *</Label>
        <Textarea
          id="c-mech"
          value={data.mechanism}
          onChange={(e) => onChange({ mechanism: e.target.value })}
          placeholder="Jelaskan mekanisme pelaksanaan campaign..."
          rows={3}
        />
      </div>
    </div>
  );
}

const QUARTER_LABEL: Record<number, string> = {
  1: "Q1 (Apr–Jun)",
  2: "Q2 (Jul–Sep)",
  3: "Q3 (Okt–Des)",
  4: "Q4 (Jan–Mar)",
};

// ─── Step 3 ────────────────────────────────────────────────────────────────

function Step3({
  data,
  onChange,
  pendingFiles,
  onAddFiles,
  onRemovePending,
  existingFiles,
  onRemoveExisting,
  masterBudgets,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  pendingFiles: PendingFile[];
  onAddFiles: (files: File[]) => void;
  onRemovePending: (localId: string) => void;
  existingFiles: CampaignFileRow[];
  onRemoveExisting: (id: string) => void;
  masterBudgets?: { id: string; promotion_category_id: string; fiscal_year: number; quarter: number; total_amount: number }[];
}) {
  const rawAvgSales = data.avg_sales_3months;
  const numAvgSales = Number(rawAvgSales.replace(/\D/g, "")) || 0;
  const rawBudget = data.requested_budget;
  const numBudget = Number(rawBudget.replace(/\D/g, "")) || 0;
  const rawSalesProjection = data.sales_projection;
  const numSalesProjection = Number(rawSalesProjection.replace(/\D/g, "")) || 0;
  const costRatio =
    numBudget > 0 && numSalesProjection > 0
      ? ((numBudget / numSalesProjection) * 100).toFixed(1)
      : null;

  function handleAvgSalesInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "");
    onChange({ avg_sales_3months: digits });
  }

  function handleBudgetInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "");
    onChange({ requested_budget: digits });
  }

  function handleSalesProjectionInput(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "");
    onChange({ sales_projection: digits });
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    onAddFiles(files);
    e.target.value = "";
  }

  const categoryBudgets = masterBudgets?.filter(
    (b) => b.promotion_category_id === data.promotion_category_id
  ) ?? [];

  return (
    <div className="space-y-4">
      {categoryBudgets.length > 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
          <p className="text-xs font-medium text-emerald-400">
            Master Budget — Kategori Promosi yang Dipilih
          </p>
          {categoryBudgets.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-400">
                {b.fiscal_year} · {QUARTER_LABEL[b.quarter] ?? `Q${b.quarter}`}
              </span>
              <span className="font-semibold text-slate-200">
                {formatIDR(b.total_amount)}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.promotion_category_id && categoryBudgets.length === 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="text-xs text-amber-400">
            Belum ada master budget untuk kategori promosi ini. Minta Admin untuk menambahkan di halaman Master Data.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="c-avg-sales">Rata-Rata Penjualan 3 Bulan Terakhir (IDR) (Opsional)</Label>
        <Input
          id="c-avg-sales"
          type="text"
          inputMode="numeric"
          value={rawAvgSales}
          onChange={handleAvgSalesInput}
          placeholder="Contoh: 200000000"
        />
        {numAvgSales > 0 && (
          <p className="text-xs text-slate-400 pl-1">{formatIDR(numAvgSales)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-budget">Budget (IDR) (Opsional)</Label>
        <Input
          id="c-budget"
          type="text"
          inputMode="numeric"
          value={rawBudget}
          onChange={handleBudgetInput}
          placeholder="Contoh: 50000000"
        />
        {numBudget > 0 && (
          <p className="text-xs text-slate-400 pl-1">{formatIDR(numBudget)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="c-sales-proj">Sales Projection (IDR) (Opsional)</Label>
        <Input
          id="c-sales-proj"
          type="text"
          inputMode="numeric"
          value={rawSalesProjection}
          onChange={handleSalesProjectionInput}
          placeholder="Contoh: 500000000"
        />
        {numSalesProjection > 0 && (
          <p className="text-xs text-slate-400 pl-1">
            {formatIDR(numSalesProjection)}
          </p>
        )}
      </div>

      <div className="rounded-md border border-white/10 bg-white/3 px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm text-slate-400">Cost Ratio</span>
        {costRatio !== null ? (
          <span className="text-sm font-semibold text-emerald-400">
            {costRatio}%
          </span>
        ) : (
          <span className="text-xs text-slate-500">
            Isi Budget & Sales Projection untuk melihat Cost Ratio
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-start">Tanggal Mulai *</Label>
          <Input
            id="c-start"
            type="date"
            value={data.start_date}
            onChange={(e) => onChange({ start_date: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-end">Tanggal Selesai *</Label>
          <Input
            id="c-end"
            type="date"
            value={data.end_date}
            min={data.start_date}
            onChange={(e) => onChange({ end_date: e.target.value })}
          />
        </div>
      </div>

      {/* File upload */}
      <div className="space-y-2">
        <Label>
          Dokumen SKP yang sudah ditandatangan*{" "}
          <span className="font-normal text-slate-400">(wajib, PDF / JPG / PNG, maks. 5 MB)</span>
        </Label>

        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 bg-white/3 p-6 cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors">
          <Upload className="h-5 w-5 text-slate-400" />
          <span className="text-sm text-slate-400">
            Klik atau drag file di sini
          </span>
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileInput}
          />
        </label>

        {/* Existing uploaded files */}
        {existingFiles.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-3 rounded-md border border-white/8 bg-white/3 px-3 py-2"
          >
            <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <span className="text-sm text-slate-300 flex-1 truncate">{f.file_name}</span>
            <span className="text-xs text-slate-500">
              {(f.file_size / 1024).toFixed(0)} KB
            </span>
            <button
              type="button"
              onClick={() => onRemoveExisting(f.id)}
              className="text-slate-500 hover:text-rose-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Pending (not yet uploaded) files */}
        {pendingFiles.map((pf) => (
          <div
            key={pf.localId}
            className="flex items-center gap-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2"
          >
            <FileText className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-slate-300 flex-1 truncate">
              {pf.file.name}
            </span>
            <span className="text-xs text-slate-500">
              {(pf.file.size / 1024).toFixed(0)} KB
            </span>
            <button
              type="button"
              onClick={() => onRemovePending(pf.localId)}
              className="text-slate-500 hover:text-rose-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateStep1(data: FormData): string | null {
  if (!data.name.trim()) return "Nama campaign harus diisi";
  if (!data.department_id) return "Departemen harus dipilih";
  if (!data.brand_id) return "Brand harus dipilih";
  if (!data.region_id) return "Region harus dipilih";
  return null;
}

function validateStep2(data: FormData): string | null {
  if (!data.channel_id) return "Channel harus dipilih";
  if (!data.promotion_category_id) return "Kategori promosi harus dipilih";
  if (!data.mechanism.trim()) return "Mekanisme harus diisi";
  return null;
}

function validateStep3(
  data: FormData,
  pendingFiles: PendingFile[],
  existingFiles: CampaignFileRow[]
): string | null {
  if (pendingFiles.length === 0 && existingFiles.length === 0)
    return "Minimal 1 file SKP harus diupload";
  if (!data.start_date) return "Tanggal mulai harus diisi";
  if (!data.end_date) return "Tanggal selesai harus diisi";
  if (data.end_date < data.start_date)
    return "Tanggal selesai harus setelah tanggal mulai";
  return null;
}

// ─── Main Modal ─────────────────────────────────────────────────────────────

const EMPTY_FORM: FormData = {
  name: "",
  department_id: "",
  brand_id: "",
  region_id: "",
  channel_id: "",
  promotion_category_id: "",
  action_approval_id: "",
  vendor_id: "",
  store_id: "",
  objective: "",
  mechanism: "",
  avg_sales_3months: "",
  requested_budget: "",
  sales_projection: "",
  start_date: "",
  end_date: "",
};

export function CampaignFormModal({
  open,
  onOpenChange,
  initialData,
  existingFiles: initialExistingFiles = [],
  departments,
  brands,
  regions,
  channels,
  categories,
  actionApprovals,
  vendors,
  masterBudgets,
  lockedRegionId,
}: CampaignFormModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState<FormData>({
    ...EMPTY_FORM,
    // Pre-set region if locked and not already set via initialData
    ...(lockedRegionId && !initialData?.region_id ? { region_id: lockedRegionId } : {}),
    ...initialData,
  });
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [existingFiles, setExistingFiles] =
    useState<CampaignFileRow[]>(initialExistingFiles);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const patch = useCallback((p: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...p }));
    setError(null);
  }, []);

  function handleClose(open: boolean) {
    if (!open) {
      setStep(1);
      setFormData({
        ...EMPTY_FORM,
        ...(lockedRegionId && !initialData?.region_id ? { region_id: lockedRegionId } : {}),
        ...initialData,
      });
      setPendingFiles([]);
      setExistingFiles(initialExistingFiles);
      setError(null);
    }
    onOpenChange(open);
  }

  function addFiles(files: File[]) {
    const valid: PendingFile[] = [];
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name}: ukuran melebihi 5 MB`);
        continue;
      }
      const allowed = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
      if (!allowed.includes(f.type)) {
        toast.error(`${f.name}: format tidak didukung`);
        continue;
      }
      valid.push({ file: f, localId: `${Date.now()}-${Math.random()}` });
    }
    setPendingFiles((prev) => [...prev, ...valid]);
  }

  function removePending(localId: string) {
    setPendingFiles((prev) => prev.filter((f) => f.localId !== localId));
  }

  function removeExisting(id: string) {
    setExistingFiles((prev) => prev.filter((f) => f.id !== id));
  }

  async function uploadPendingFiles(campaignId: string) {
    for (const pf of pendingFiles) {
      const fd = new FormData();
      fd.append("file", pf.file);
      fd.append("campaign_id", campaignId);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json();
        toast.error(`Upload ${pf.file.name}: ${body.error ?? "Gagal"}`);
      }
    }
    setPendingFiles([]);
  }

  async function handleSaveDraft() {
    const step1Error = validateStep1(formData);
    if (step1Error) {
      setError(step1Error);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await saveDraftCampaignAction({
        id: formData.id,
        name: formData.name,
        department_id: formData.department_id,
        brand_id: formData.brand_id,
        region_id: formData.region_id,
        channel_id: formData.channel_id || null,
        promotion_category_id: formData.promotion_category_id || null,
        action_approval_id: formData.action_approval_id || null,
        vendor_id: formData.vendor_id || null,
        store_id: formData.store_id || null,
        objective: formData.objective || null,
        mechanism: formData.mechanism || null,
        avg_sales_3months: Number(formData.avg_sales_3months.replace(/\D/g, "")) || 0,
        requested_budget: Number(formData.requested_budget.replace(/\D/g, "")) || 0,
        sales_projection: Number(formData.sales_projection.replace(/\D/g, "")) || 0,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      const campaignId = result.campaignId!;
      patch({ id: campaignId });

      if (pendingFiles.length > 0) {
        await uploadPendingFiles(campaignId);
      }

      toast.success("Draft disimpan");
      handleClose(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleNext() {
    let err: string | null = null;
    if (step === 1) err = validateStep1(formData);
    else if (step === 2) err = validateStep2(formData);

    if (err) {
      setError(err);
      return;
    }

    // If moving from Step 1 and no campaign ID yet, auto-save draft
    if (step === 1 && !formData.id) {
      setIsSaving(true);
      try {
        const result = await saveDraftCampaignAction({
          name: formData.name,
          department_id: formData.department_id,
          brand_id: formData.brand_id,
          region_id: formData.region_id,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        patch({ id: result.campaignId });
      } finally {
        setIsSaving(false);
      }
    }

    setError(null);
    setStep((prev) => (prev < 3 ? ((prev + 1) as 1 | 2 | 3) : prev));
  }

  async function handleSubmit() {
    const step1Error = validateStep1(formData);
    const step2Error = validateStep2(formData);
    const step3Error = validateStep3(formData, pendingFiles, existingFiles);
    const firstError = step1Error ?? step2Error ?? step3Error;
    if (firstError) {
      setError(firstError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      // Ensure we have a campaign ID (create draft first if needed)
      let campaignId = formData.id;
      if (!campaignId) {
        const draft = await saveDraftCampaignAction({
          name: formData.name,
          department_id: formData.department_id,
          brand_id: formData.brand_id,
          region_id: formData.region_id,
        });
        if (draft.error) {
          setError(draft.error);
          return;
        }
        campaignId = draft.campaignId!;
        patch({ id: campaignId });
      }

      if (pendingFiles.length > 0) {
        await uploadPendingFiles(campaignId);
      }

      const result = await submitCampaignAction({
        id: campaignId,
        name: formData.name,
        department_id: formData.department_id,
        brand_id: formData.brand_id,
        region_id: formData.region_id,
        channel_id: formData.channel_id,
        promotion_category_id: formData.promotion_category_id,
        action_approval_id: formData.action_approval_id || null,
        vendor_id: formData.vendor_id || null,
        store_id: formData.store_id || null,
        objective: formData.objective || null,
        mechanism: formData.mechanism,
        avg_sales_3months: Number(formData.avg_sales_3months.replace(/\D/g, "")),
        requested_budget: Number(formData.requested_budget.replace(/\D/g, "")),
        sales_projection: Number(formData.sales_projection.replace(/\D/g, "")) || 0,
        start_date: formData.start_date,
        end_date: formData.end_date,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      toast.success("SKP berhasil diajukan!");
      handleClose(false);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = isSaving || isSubmitting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {formData.id ? "Edit SKP" : "SKP Baru"}
          </DialogTitle>
        </DialogHeader>

        <div className="pt-2">
          <StepIndicator current={step} />

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 1 && (
            <Step1
              data={formData}
              onChange={patch}
              departments={departments}
              brands={brands}
              regions={regions}
              lockedRegionId={lockedRegionId}
            />
          )}
          {step === 2 && (
            <Step2
              data={formData}
              onChange={patch}
              channels={channels}
              categories={categories}
              actionApprovals={actionApprovals}
              vendors={vendors}
            />
          )}
          {step === 3 && (
            <Step3
              data={formData}
              onChange={patch}
              pendingFiles={pendingFiles}
              onAddFiles={addFiles}
              onRemovePending={removePending}
              existingFiles={existingFiles}
              onRemoveExisting={removeExisting}
              masterBudgets={masterBudgets}
            />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/8">
            <div className="flex gap-2">
              {step > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep((p) => (p > 1 ? ((p - 1) as 1 | 2 | 3) : p))}
                  disabled={busy}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Kembali
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveDraft}
                disabled={busy}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Simpan Draft
              </Button>

              {step < 3 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleNext}
                  disabled={busy}
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  Lanjut
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={busy}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  Ajukan SKP
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

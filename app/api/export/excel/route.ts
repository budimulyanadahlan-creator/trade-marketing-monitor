import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import type { UserRole, CampaignStatus } from "@/types/database";

const ALLOWED_ROLES: UserRole[] = ["admin", "finance", "manager", "superadmin", "distributor"];

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  submitted: "Diajukan",
  approved_l1: "Disetujui L1",
  approved_l2: "Disetujui L2",
  approved_l3: "Disetujui L3",
  approved_l4: "Disetujui L4",
  approved: "Disetujui",
  rejected: "Ditolak",
  ongoing: "Berjalan",
  claim_submitted: "Klaim Diajukan",
  paid: "Paid",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

function fmtDate(s: string | null): string {
  if (!s) return "";
  return new Date(s).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const CAMPAIGN_SELECT = `
  id, name, status, skp_number, aa_reference_number,
  requested_budget, actual_spent, sales_projection,
  mechanism, objective, store_id, start_date, end_date, submitted_at, created_at,
  department:departments(name),
  brand:brands(name),
  region:regions(name),
  channel:channels(name),
  promotion_category:promotion_categories(name, account_code),
  action_approval:action_approvals(name),
  vendor:vendors(name),
  realizations(invoice_number, amount, realization_date)
`;

type JoinedName = { name: string } | null;
type JoinedPromoCategory = { name: string; account_code: string } | null;
type RealizationEntry = { invoice_number: string; amount: number; realization_date: string };

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  skp_number: string | null;
  aa_reference_number: string | null;
  requested_budget: number;
  actual_spent: number;
  sales_projection: number;
  mechanism: string;
  objective: string | null;
  store_id: string | null;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  created_at: string;
  department: JoinedName;
  brand: JoinedName;
  region: JoinedName;
  channel: JoinedName;
  promotion_category: JoinedPromoCategory;
  action_approval: JoinedName;
  vendor: JoinedName;
  realizations: RealizationEntry[];
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, department_id, region_id, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) {
    return NextResponse.json({ error: "Akun tidak aktif" }, { status: 403 });
  }

  const role = profile.role as UserRole;
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const isDistributor = role === "distributor";
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";

  let query = supabase
    .from("campaigns")
    .select(CAMPAIGN_SELECT)
    .order("created_at", { ascending: false });

  let receiptedSet = new Set<string>();

  if (isDistributor) {
    query = query.eq("status", "approved");
    if (profile.region_id) query = query.eq("region_id", profile.region_id);

    const { data: allDepts } = await supabase.from("departments").select("id, name");
    const targetDeptIds = (allDepts ?? [])
      .filter((d) => {
        const n = d.name.toLowerCase();
        return n.includes("sales") || n.includes("trade");
      })
      .map((d) => d.id);
    if (targetDeptIds.length > 0) query = query.in("department_id", targetDeptIds);

    if (dateFrom) query = query.gte("start_date", dateFrom);
    if (dateTo) query = query.lte("start_date", dateTo);

    const { data: receipts } = await supabase
      .from("distributor_receipts")
      .select("campaign_id")
      .eq("received_by", user.id);
    receiptedSet = new Set((receipts ?? []).map((r) => r.campaign_id));
  } else {
    const statusParam = searchParams.get("status") ?? "";
    const statusFilters = statusParam
      ? (statusParam.split(",").map((s) => s.trim()).filter(Boolean) as CampaignStatus[])
      : [];
    const brandId = searchParams.get("brand") ?? "";
    const regionId = searchParams.get("region") ?? "";
    const departmentId = searchParams.get("department") ?? "";
    const actionApprovalId = searchParams.get("action_approval") ?? "";

    if (statusFilters.length > 0) query = query.in("status", statusFilters);
    if (brandId) query = query.eq("brand_id", brandId);
    if (regionId) query = query.eq("region_id", regionId);
    if (departmentId) query = query.eq("department_id", departmentId);
    if (actionApprovalId) query = query.eq("action_approval_id", actionApprovalId);
    if (dateFrom) query = query.gte("start_date", dateFrom);
    if (dateTo) query = query.lte("start_date", dateTo);
  }

  const { data: rawData, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaigns = (rawData ?? []) as unknown as CampaignRow[];

  let rows: Record<string, string | number>[];
  let colWidths: { wch: number }[];
  let sheetName: string;

  if (isDistributor) {
    rows = campaigns.map((c) => {
      const pctSpent =
        c.requested_budget > 0
          ? parseFloat(((c.actual_spent / c.requested_budget) * 100).toFixed(2))
          : 0;
      return {
        "No. SKP": c.skp_number ?? "—",
        "No. AA Reference": c.aa_reference_number ?? "—",
        "Nama SKP": c.name,
        Departemen: c.department?.name ?? "",
        Region: c.region?.name ?? "",
        Channel: c.channel?.name ?? "",
        "Promo Category": c.promotion_category?.name ?? "",
        "Kode Akun": c.promotion_category?.account_code ?? "",
        "ID Store": c.store_id ?? "",
        "Budget (IDR)": c.requested_budget,
        "Sales Projection (IDR)": c.sales_projection,
        "Realisasi (IDR)": c.actual_spent,
        "Serapan (%)": pctSpent,
        Status: STATUS_LABELS[c.status as CampaignStatus] ?? c.status,
        "Tanggal Mulai": fmtDate(c.start_date),
        "Tanggal Selesai": fmtDate(c.end_date),
        "Status Penerimaan": receiptedSet.has(c.id) ? "Sudah Diterima" : "Belum Diterima",
      };
    });
    colWidths = [
      { wch: 18 }, // No. SKP
      { wch: 18 }, // No. AA Reference
      { wch: 30 }, // Nama SKP
      { wch: 18 }, // Departemen
      { wch: 15 }, // Region
      { wch: 12 }, // Channel
      { wch: 22 }, // Promo Category
      { wch: 12 }, // Kode Akun
      { wch: 15 }, // ID Store
      { wch: 18 }, // Budget
      { wch: 20 }, // Sales Projection
      { wch: 18 }, // Realisasi
      { wch: 12 }, // Serapan
      { wch: 14 }, // Status
      { wch: 14 }, // Tanggal Mulai
      { wch: 14 }, // Tanggal Selesai
      { wch: 16 }, // Status Penerimaan
    ];
    sheetName = "Rekap SKP Distributor";
  } else {
    rows = campaigns.map((c) => {
      const realizations = c.realizations ?? [];
      const pctSpent =
        c.requested_budget > 0
          ? parseFloat(((c.actual_spent / c.requested_budget) * 100).toFixed(2))
          : 0;
      const costRatio =
        c.sales_projection > 0
          ? parseFloat(((c.requested_budget / c.sales_projection) * 100).toFixed(2))
          : null;
      const invoiceNumbers = realizations.map((r) => r.invoice_number).join(", ");

      return {
        "No. SKP": c.skp_number ?? "—",
        "No. AA Reference": c.aa_reference_number ?? "—",
        "Nama SKP": c.name,
        Departemen: c.department?.name ?? "",
        Brand: c.brand?.name ?? "",
        Region: c.region?.name ?? "",
        Channel: c.channel?.name ?? "",
        "Promo Category": c.promotion_category?.name ?? "",
        "Kode Akun": c.promotion_category?.account_code ?? "",
        "ID Store": c.store_id ?? "",
        "Action Approval (AA)": c.action_approval?.name ?? "",
        Vendor: c.vendor?.name ?? "",
        Objective: c.objective ?? "",
        Mekanisme: c.mechanism ?? "",
        "Budget (IDR)": c.requested_budget,
        "Sales Projection (IDR)": c.sales_projection,
        "Cost Ratio (%)": costRatio ?? "",
        "Realisasi (IDR)": c.actual_spent,
        "Serapan (%)": pctSpent,
        "Sisa Budget (IDR)": c.requested_budget - c.actual_spent,
        Status: STATUS_LABELS[c.status as CampaignStatus] ?? c.status,
        "Tanggal Mulai": fmtDate(c.start_date),
        "Tanggal Selesai": fmtDate(c.end_date),
        "Tanggal Diajukan": fmtDate(c.submitted_at),
        "Jml Invoice": realizations.length,
        "No. Invoice": invoiceNumbers,
        "Dibuat Pada": fmtDate(c.created_at),
      };
    });
    colWidths = [
      { wch: 18 }, { wch: 18 }, // No. SKP, No. AA Reference
      { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 8 },
      { wch: 20 }, { wch: 12 }, { wch: 15 }, { wch: 25 }, { wch: 20 },
      { wch: 30 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
      { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 35 }, { wch: 14 },
    ];
    sheetName = "Rekap SKP";
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const today = new Date().toISOString().slice(0, 10);
  const filename = isDistributor
    ? `rekap-skp-distributor-${today}.xlsx`
    : `rekap-skp-${today}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

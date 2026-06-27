import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { UserRole, CampaignStatus } from "@/types/database";

const ALLOWED_ROLES: UserRole[] = ["admin", "finance", "manager", "superadmin"];

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1e293b",
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: "#10b981",
    borderBottomStyle: "solid",
  },
  companyName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#10b981",
  },
  reportTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    color: "#0f172a",
  },
  reportMeta: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 3,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: "#f1f5f9",
    color: "#0f172a",
  },
  kpiRow: {
    flexDirection: "row",
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  kpiLabel: {
    fontSize: 7,
    color: "#64748b",
    textTransform: "uppercase",
  },
  kpiValue: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
    color: "#0f172a",
  },
  table: {
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
  },
  tableRow: {
    flexDirection: "row",
  },
  tableRowAlt: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
  },
  tableTotalRow: {
    flexDirection: "row",
    backgroundColor: "#f0fdf4",
  },
  th: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
  },
  td: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    fontSize: 8,
    color: "#1e293b",
  },
  tdBold: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderTopStyle: "solid",
    paddingTop: 6,
  },
});

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtPct(spent: number, budget: number): string {
  if (budget === 0) return "0%";
  return ((spent / budget) * 100).toFixed(1) + "%";
}

// ── Quarter logic (matches dashboard) ─────────────────────────────────────────

function getQuarterRange(year: number, quarter: number): [string, string] {
  const monthStarts = ["04", "07", "10", "01"];
  const monthEnds = ["07", "10", "01", "04"];
  const startYear = quarter === 4 ? year + 1 : year;
  const endYear = quarter >= 3 ? year + 1 : year;
  return [
    `${startYear}-${monthStarts[quarter - 1]}-01`,
    `${endYear}-${monthEnds[quarter - 1]}-01`,
  ];
}

// ── PDF Document ──────────────────────────────────────────────────────────────

type QuarterRow = { quarter: string; budget: number; spent: number };
type BrandRow = { name: string; budget: number; spent: number };

type PdfData = {
  fiscalYear: number;
  generatedAt: string;
  scopeLabel: string;
  activeFilters: string;
  totalBudget: number;
  totalSpent: number;
  activeCampaigns: number;
  quarterData: QuarterRow[];
  topBrands: BrandRow[];
};

function DashboardPDF({ data }: { data: PdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.companyName}>PT. Want-Want Indonesia</Text>
          <Text style={styles.reportTitle}>
            Laporan Rekap Anggaran Campaign — Fiskal {data.fiscalYear}
          </Text>
          <Text style={styles.reportMeta}>
            Digenerate: {data.generatedAt} | Cakupan: {data.scopeLabel}
          </Text>
          {data.activeFilters && (
            <Text style={styles.reportMeta}>Filter aktif: {data.activeFilters}</Text>
          )}
        </View>

        {/* KPI Cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ringkasan KPI</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Total Budget</Text>
              <Text style={styles.kpiValue}>{fmtIDR(data.totalBudget)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Total Realisasi</Text>
              <Text style={styles.kpiValue}>{fmtIDR(data.totalSpent)}</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Sisa Anggaran</Text>
              <Text style={styles.kpiValue}>
                {fmtIDR(data.totalBudget - data.totalSpent)}
              </Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>SKP Aktif</Text>
              <Text style={styles.kpiValue}>{data.activeCampaigns}</Text>
            </View>
          </View>
        </View>

        {/* Budget vs Actual per Quarter */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Budget vs. Realisasi per Kuartal</Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.th}>Kuartal</Text>
              <Text style={styles.th}>Budget (IDR)</Text>
              <Text style={styles.th}>Realisasi (IDR)</Text>
              <Text style={styles.th}>Serapan</Text>
            </View>
            {data.quarterData.map((q, i) => (
              <View
                key={q.quarter}
                style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
              >
                <Text style={styles.td}>{q.quarter} (Apr–Mar)</Text>
                <Text style={styles.td}>{fmtIDR(q.budget)}</Text>
                <Text style={styles.td}>{fmtIDR(q.spent)}</Text>
                <Text style={styles.td}>{fmtPct(q.spent, q.budget)}</Text>
              </View>
            ))}
            <View style={styles.tableTotalRow}>
              <Text style={styles.tdBold}>TOTAL</Text>
              <Text style={styles.tdBold}>{fmtIDR(data.totalBudget)}</Text>
              <Text style={styles.tdBold}>{fmtIDR(data.totalSpent)}</Text>
              <Text style={styles.tdBold}>
                {fmtPct(data.totalSpent, data.totalBudget)}
              </Text>
            </View>
          </View>
        </View>

        {/* Top 5 Brands */}
        {data.topBrands.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top 5 Brand berdasarkan Realisasi</Text>
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.th, { flex: 0.4 }]}>No.</Text>
                <Text style={[styles.th, { flex: 2 }]}>Brand</Text>
                <Text style={styles.th}>Budget (IDR)</Text>
                <Text style={styles.th}>Realisasi (IDR)</Text>
                <Text style={styles.th}>Serapan</Text>
              </View>
              {data.topBrands.slice(0, 5).map((b, i) => (
                <View
                  key={b.name}
                  style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}
                >
                  <Text style={[styles.td, { flex: 0.4 }]}>{i + 1}</Text>
                  <Text style={[styles.td, { flex: 2 }]}>{b.name}</Text>
                  <Text style={styles.td}>{fmtIDR(b.budget)}</Text>
                  <Text style={styles.td}>{fmtIDR(b.spent)}</Text>
                  <Text style={styles.td}>{fmtPct(b.spent, b.budget)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer} fixed>
          PT. Want-Want Indonesia — Trade Marketing Budget Management System — Dokumen ini digenerate
          secara otomatis pada {data.generatedAt}
        </Text>
      </Page>
    </Document>
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

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
    .select("role, department_id, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active) {
    return NextResponse.json({ error: "Akun tidak aktif" }, { status: 403 });
  }

  const role = profile.role as UserRole;
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Tidak punya akses" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fiscalYear = parseInt(searchParams.get("fiscal_year") ?? "") || new Date().getFullYear();
  const quarter = searchParams.get("quarter") ?? "";
  const departmentId = searchParams.get("department") ?? "";
  const brandId = searchParams.get("brand") ?? "";
  const regionId = searchParams.get("region") ?? "";
  const programId = searchParams.get("program") ?? "";
  const promoCatId = searchParams.get("promo_category") ?? "";

  // Build campaign query (same logic as dashboard page)
  let campaignQuery = supabase
    .from("campaigns")
    .select(
      `id, name, requested_budget, actual_spent, status, start_date, brand_id,
       brand:brands(name),
       department:departments(name)`
    )
    .not("status", "in", "(draft,cancelled)");

  if (role === "user") {
    campaignQuery = campaignQuery.eq("created_by", user.id);
  } else if (role === "manager" && profile.department_id) {
    campaignQuery = campaignQuery.eq("department_id", profile.department_id);
  }

  if (departmentId) campaignQuery = campaignQuery.eq("department_id", departmentId);
  if (brandId) campaignQuery = campaignQuery.eq("brand_id", brandId);
  if (regionId) campaignQuery = campaignQuery.eq("region_id", regionId);
  if (programId) campaignQuery = campaignQuery.eq("action_approval_id", programId);
  if (promoCatId) campaignQuery = campaignQuery.eq("promotion_category_id", promoCatId);

  if (quarter && ["1", "2", "3", "4"].includes(quarter)) {
    const [dateStart, dateEnd] = getQuarterRange(fiscalYear, parseInt(quarter));
    campaignQuery = campaignQuery
      .gte("start_date", dateStart)
      .lt("start_date", dateEnd);
  } else {
    campaignQuery = campaignQuery
      .gte("start_date", `${fiscalYear}-01-01`)
      .lt("start_date", `${fiscalYear + 1}-01-01`);
  }

  const { data: rawCampaigns, error } = await campaignQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type CampaignItem = {
    id: string;
    name: string;
    requested_budget: number;
    actual_spent: number;
    status: CampaignStatus;
    start_date: string | null;
    brand_id: string;
    brand: { name: string } | null;
    department: { name: string } | null;
  };

  const campaigns = (rawCampaigns ?? []) as CampaignItem[];

  // ── Aggregations (mirrors dashboard) ──────────────────────────────────────

  const totalBudget = campaigns.reduce((s, c) => s + c.requested_budget, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.actual_spent, 0);
  const activeCampaigns = campaigns.filter(
    (c) => c.status === "approved" || c.status === "ongoing"
  ).length;

  const quarterData: QuarterRow[] = [
    { quarter: "Q1", budget: 0, spent: 0 },
    { quarter: "Q2", budget: 0, spent: 0 },
    { quarter: "Q3", budget: 0, spent: 0 },
    { quarter: "Q4", budget: 0, spent: 0 },
  ];

  for (const c of campaigns) {
    if (c.start_date) {
      const month = new Date(c.start_date).getMonth() + 1;
      const q = month >= 4 ? Math.ceil((month - 3) / 3) - 1 : 3;
      if (q >= 0 && q < 4) {
        quarterData[q].budget += c.requested_budget;
        quarterData[q].spent += c.actual_spent;
      }
    }
  }

  const brandMap = new Map<string, BrandRow>();
  for (const c of campaigns) {
    const name = c.brand?.name ?? "Unknown";
    const prev = brandMap.get(c.brand_id) ?? { name, spent: 0, budget: 0 };
    prev.spent += c.actual_spent;
    prev.budget += c.requested_budget;
    brandMap.set(c.brand_id, prev);
  }
  const topBrands = Array.from(brandMap.values())
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  // ── Scope label and active filter summary ─────────────────────────────────

  const scopeLabel =
    role === "user"
      ? "SKP milik Anda"
      : role === "manager"
      ? "SKP departemen Anda"
      : "Semua SKP";

  const filterParts: string[] = [];
  if (quarter) filterParts.push(`Q${quarter}`);
  if (departmentId) filterParts.push("Departemen terfilter");
  if (brandId) filterParts.push("Brand terfilter");
  if (regionId) filterParts.push("Region terfilter");
  if (programId) filterParts.push("AA terfilter");
  if (promoCatId) filterParts.push("Promo Cat terfilter");

  const generatedAt = new Date().toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const pdfData: PdfData = {
    fiscalYear,
    generatedAt,
    scopeLabel,
    activeFilters: filterParts.join(", "),
    totalBudget,
    totalSpent,
    activeCampaigns,
    quarterData,
    topBrands,
  };

  const element = React.createElement(
    DashboardPDF,
    { data: pdfData }
  ) as unknown as React.ReactElement<DocumentProps>;

  const buf = await renderToBuffer(element);

  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="dashboard-rekap-${today}.pdf"`,
    },
  });
}

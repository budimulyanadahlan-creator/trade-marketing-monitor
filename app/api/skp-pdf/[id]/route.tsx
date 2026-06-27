import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import React from "react";
import path from "path";
import fs from "fs";
import type { DocumentProps } from "@react-pdf/renderer";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import type { UserRole } from "@/types/database";

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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  headerLeft: {},
  companyName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#10b981",
  },
  docTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 3,
    color: "#0f172a",
  },
  docSubtitle: {
    fontSize: 8,
    color: "#64748b",
    marginTop: 2,
  },
  headerRight: {
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  logo: {
    width: 70,
    height: 70,
    objectFit: "contain",
    marginBottom: 4,
  },
  statusBadge: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    backgroundColor: "#10b981",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: "#f1f5f9",
    color: "#334155",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoTable: {
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
  },
  infoRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  infoLabel: {
    width: 140,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#475569",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
    backgroundColor: "#f8fafc",
  },
  infoValue: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontSize: 9,
    color: "#0f172a",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  infoValueHighlight: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#059669",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  approvalTable: {
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
  },
  approvalHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  approvalRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  thNo: {
    width: 24,
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
    textAlign: "center",
  },
  th: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  tdNo: {
    width: 24,
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontSize: 8,
    color: "#64748b",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
    textAlign: "center",
  },
  td: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8,
    color: "#1e293b",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  tdItalic: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8,
    color: "#374151",
    fontFamily: "Helvetica-Oblique",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  sigBoxRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
    backgroundColor: "#fafafa",
  },
  sigBoxPlaceholder: {
    width: 24,
    height: 50,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  sigBoxCell: {
    flex: 1,
    height: 50,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    borderRightStyle: "solid",
  },
  sigBoxLabel: {
    fontSize: 7,
    color: "#94a3b8",
    fontFamily: "Helvetica-Oblique",
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

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}


// ── Data Types ────────────────────────────────────────────────────────────────

type ApprovalEntry = {
  id: string;
  action: string;
  role: string;
  signature_text: string | null;
  signature_image: string | null;
  comment: string | null;
  created_at: string;
  actor: { full_name: string } | null;
};

type SignatureRow = {
  label: string;
  actorName: string | null;
  signatureText: string | null;
  signatureImage: string | null;
  timestamp: string | null;
  isSigned: boolean;
  isSubmitter: boolean;
};

type SkpData = {
  id: string;
  name: string;
  status: string;
  skp_number: string | null;
  department: string;
  brand: string;
  region: string;
  channel: string;
  promotion_category: string;
  action_approval: string;
  vendor: string;
  objective: string;
  mechanism: string;
  requested_budget: number;
  sales_projection: number;
  cost_ratio: string;
  start_date: string | null;
  end_date: string | null;
  approvalHistory: ApprovalEntry[];
  signatureRows: SignatureRow[];
  generatedAt: string;
};

// ── PDF Document ──────────────────────────────────────────────────────────────

function getLogoBase64(): string | null {
  try {
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    if (!fs.existsSync(logoPath)) return null;
    const buf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function SkpPDF({ data }: { data: SkpData }) {
  const logoSrc = getLogoBase64();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.companyName}>PT. Want-Want Indonesia</Text>
            <Text style={styles.docTitle}>Surat Kegiatan Promosi (SKP)</Text>
            <Text style={styles.docSubtitle}>
              AA: {data.action_approval || "—"} · Digenerate: {data.generatedAt}
            </Text>
          </View>
          <View style={styles.headerRight}>
            {logoSrc && (
              <Image src={logoSrc} style={styles.logo} />
            )}
            <Text style={styles.statusBadge}>APPROVED</Text>
          </View>
        </View>

        {/* SKP Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informasi SKP</Text>
          <View style={styles.infoTable}>
            <InfoRow label="Nomor SKP" value={data.skp_number ?? "—"} />
            <InfoRow label="Nama SKP" value={data.name} />
            <InfoRow label="Action Approval (AA)" value={data.action_approval} />
            <InfoRow label="Departemen" value={data.department} />
            <InfoRow label="Brand" value={data.brand} />
            <InfoRow label="Region" value={data.region} />
            <InfoRow label="Channel" value={data.channel} />
            <InfoRow label="Kategori Promosi" value={data.promotion_category} />
            <InfoRow label="Vendor" value={data.vendor} />
            <InfoRow label="Objective" value={data.objective} />
            <InfoRow label="Mekanisme" value={data.mechanism} />
            <InfoRow
              label="Budget Diajukan"
              value={fmtIDR(data.requested_budget)}
              highlight
            />
            {data.sales_projection > 0 && (
              <InfoRow
                label="Sales Projection"
                value={fmtIDR(data.sales_projection)}
              />
            )}
            {data.sales_projection > 0 && data.requested_budget > 0 && (
              <InfoRow label="Cost Ratio" value={data.cost_ratio} />
            )}
            <InfoRow
              label="Periode"
              value={
                data.start_date && data.end_date
                  ? `${fmtDate(data.start_date)} s.d. ${fmtDate(data.end_date)}`
                  : "—"
              }
            />
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          PT. Want-Want Indonesia — Trade Marketing Budget Management System · Dokumen ini
          digenerate otomatis pada {data.generatedAt} · SKP: {data.name}
        </Text>
      </Page>
    </Document>
  );
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={highlight ? styles.infoValueHighlight : styles.infoValue}>
        {value || "—"}
      </Text>
    </View>
  );
}

// ── Route Handler ─────────────────────────────────────────────────────────────

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
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

  // Fetch campaign with all joins
  const { data: campaignRaw, error: campaignError } = await supabase
    .from("campaigns")
    .select(
      `
      id, name, status, mechanism, objective,
      requested_budget, sales_projection, actual_spent,
      start_date, end_date, created_by,
      region_id, department_id,
      skp_number,
      department:departments(name),
      brand:brands(name),
      region:regions(name),
      channel:channels(name),
      promotion_category:promotion_categories(name, account_code),
      action_approval:action_approvals(name),
      vendor:vendors(name)
    `
    )
    .eq("id", id)
    .single();

  if (campaignError || !campaignRaw) {
    return NextResponse.json({ error: "SKP tidak ditemukan" }, { status: 404 });
  }

  const campaign = campaignRaw as {
    id: string;
    name: string;
    status: string;
    skp_number: string | null;
    mechanism: string;
    objective: string | null;
    requested_budget: number;
    sales_projection: number;
    actual_spent: number;
    start_date: string | null;
    end_date: string | null;
    created_by: string;
    region_id: string;
    department_id: string;
    department: { name: string } | null;
    brand: { name: string } | null;
    region: { name: string } | null;
    channel: { name: string } | null;
    promotion_category: { name: string; account_code: string } | null;
    action_approval: { name: string } | null;
    vendor: { name: string } | null;
  };

  // Only generate PDF for fully-approved campaigns
  if (campaign.status !== "approved" && campaign.status !== "ongoing" && campaign.status !== "claim_submitted" && campaign.status !== "paid" && campaign.status !== "completed") {
    return NextResponse.json(
      { error: "PDF hanya tersedia untuk SKP yang sudah fully approved" },
      { status: 403 }
    );
  }

  // Role-based access check
  const canAccess = (() => {
    if (role === "admin" || role === "superadmin") return true;
    if (role === "user" || role === "manager") {
      return campaign.created_by === user.id;
    }
    if (role === "finance") return true;
    if (role === "distributor") {
      return campaign.region_id === profile.region_id;
    }
    return false;
  })();

  if (!canAccess) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }

  // Fetch approval history + levels + creator — admin client bypasses RLS
  const supabaseAdmin = createAdminClient();
  const [
    { data: historyRaw },
    { data: levelsRaw },
    { data: creatorData },
  ] = await Promise.all([
    supabaseAdmin
      .from("approval_history")
      .select("id, action, role, signature_text, signature_image, comment, created_at, actor:users!approval_history_actor_id_fkey(full_name)")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("approval_levels")
      .select("id, name, sequence")
      .eq("is_active", true)
      .order("sequence"),
    supabaseAdmin
      .from("users")
      .select("full_name")
      .eq("id", campaign.created_by)
      .single(),
  ]);

  const approvalHistory = (historyRaw ?? []) as unknown as ApprovalEntry[];
  const approvalLevels = levelsRaw ?? [];
  const maxLevelSeq =
    approvalLevels.length > 0
      ? approvalLevels[approvalLevels.length - 1].sequence
      : 0;

  // Approval entries sorted by time (excludes submitted/rejected)
  const approvalEntries = [...approvalHistory]
    .filter((h) => h.action !== "submitted" && h.action !== "rejected")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Determine if a level was passed based on campaign status (fallback when history is missing)
  function wasLevelPassed(levelSeq: number): boolean {
    const s = campaign.status;
    if (["approved", "ongoing", "claim_submitted", "paid", "completed"].includes(s)) return true;
    const m = s.match(/^approved_l(\d+)$/);
    if (m) return levelSeq <= parseInt(m[1]);
    return false;
  }

  // Build signature rows: 1 submitter row + 1 row per approval level
  const submittedEntry = approvalHistory.find((h) => h.action === "submitted");
  const signatureRows: SignatureRow[] = [
    {
      label: "Pengaju",
      actorName: submittedEntry?.actor?.full_name ?? creatorData?.full_name ?? "—",
      signatureText: null,
      signatureImage: null,
      timestamp: submittedEntry?.created_at ?? null,
      isSigned: !!submittedEntry,
      isSubmitter: true,
    },
    ...approvalLevels.map((level, levelIdx) => {
      // Strategy 1: match by action key (most accurate)
      const actionKey =
        level.sequence >= maxLevelSeq
          ? "approved"
          : `approved_l${level.sequence}`;
      let entry = approvalHistory.find((h) => h.action === actionKey);

      // Strategy 2: match by chronological order when action-key lookup fails
      // (covers cases where level config changed after campaign was approved)
      if (!entry) {
        entry = approvalEntries[levelIdx];
      }

      return {
        label: level.name,
        actorName: entry?.actor?.full_name ?? null,
        signatureText: entry?.signature_text ?? null,
        signatureImage: entry?.signature_image ?? null,
        timestamp: entry?.created_at ?? null,
        // Strategy 3: use campaign status if no history entry found
        isSigned: !!entry || wasLevelPassed(level.sequence),
        isSubmitter: false,
      };
    }),
  ];

  const costRatio =
    campaign.sales_projection > 0 && campaign.requested_budget > 0
      ? ((campaign.requested_budget / campaign.sales_projection) * 100).toFixed(1) + "%"
      : "—";

  const generatedAt = new Date().toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const skpData: SkpData = {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    skp_number: campaign.skp_number ?? null,
    department: campaign.department?.name ?? "—",
    brand: campaign.brand?.name ?? "—",
    region: campaign.region?.name ?? "—",
    channel: campaign.channel?.name ?? "—",
    promotion_category: campaign.promotion_category
      ? `[${campaign.promotion_category.account_code}] ${campaign.promotion_category.name}`
      : "—",
    action_approval: campaign.action_approval?.name ?? "—",
    vendor: campaign.vendor?.name ?? "—",
    objective: campaign.objective ?? "—",
    mechanism: campaign.mechanism ?? "—",
    requested_budget: campaign.requested_budget,
    sales_projection: campaign.sales_projection,
    cost_ratio: costRatio,
    start_date: campaign.start_date,
    end_date: campaign.end_date,
    approvalHistory,
    signatureRows,
    generatedAt,
  };

  const element = React.createElement(SkpPDF, {
    data: skpData,
  }) as unknown as React.ReactElement<DocumentProps>;

  const skpBuf = await renderToBuffer(element);

  const safeName = campaign.name
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .substring(0, 50);

  // Fetch attachments ordered by upload time
  const { data: campaignFiles } = await supabaseAdmin
    .from("campaign_files")
    .select("id, file_name, file_url, file_type")
    .eq("campaign_id", id)
    .order("uploaded_at", { ascending: true });

  // If no attachments, return the SKP PDF directly
  if (!campaignFiles || campaignFiles.length === 0) {
    return new NextResponse(new Uint8Array(skpBuf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="SKP-${safeName}.pdf"`,
      },
    });
  }

  // Merge SKP PDF with attachments using pdf-lib
  const mergedPdf = await PDFDocument.load(skpBuf);

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  for (const file of campaignFiles) {
    const { data: signedUrlData } = await supabaseAdmin.storage
      .from("campaign-documents")
      .createSignedUrl(file.file_url, 300); // 5 min — enough for server-side download

    if (!signedUrlData?.signedUrl) continue;

    let fileBytes: ArrayBuffer;
    try {
      const res = await fetch(signedUrlData.signedUrl);
      if (!res.ok) continue;
      fileBytes = await res.arrayBuffer();
    } catch {
      continue;
    }

    const mimeType = file.file_type?.toLowerCase() ?? "";

    if (mimeType === "application/pdf") {
      try {
        const attachPdf = await PDFDocument.load(fileBytes);
        const pages = await mergedPdf.copyPages(attachPdf, attachPdf.getPageIndices());
        pages.forEach((p) => mergedPdf.addPage(p));
      } catch {
        // Skip corrupted/unreadable PDFs
      }
    } else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
      try {
        const img = await mergedPdf.embedJpg(fileBytes);
        const { width, height } = img;
        const isLandscape = width > height;
        const pageW = isLandscape ? A4_HEIGHT : A4_WIDTH;
        const pageH = isLandscape ? A4_WIDTH : A4_HEIGHT;
        const page = mergedPdf.addPage([pageW, pageH]);
        const dims = img.scaleToFit(pageW, pageH);
        page.drawImage(img, {
          x: (pageW - dims.width) / 2,
          y: (pageH - dims.height) / 2,
          width: dims.width,
          height: dims.height,
        });
      } catch {
        // Skip unreadable images
      }
    } else if (mimeType === "image/png") {
      try {
        const img = await mergedPdf.embedPng(fileBytes);
        const { width, height } = img;
        const isLandscape = width > height;
        const pageW = isLandscape ? A4_HEIGHT : A4_WIDTH;
        const pageH = isLandscape ? A4_WIDTH : A4_HEIGHT;
        const page = mergedPdf.addPage([pageW, pageH]);
        const dims = img.scaleToFit(pageW, pageH);
        page.drawImage(img, {
          x: (pageW - dims.width) / 2,
          y: (pageH - dims.height) / 2,
          width: dims.width,
          height: dims.height,
        });
      } catch {
        // Skip unreadable images
      }
    }
  }

  const mergedBytes = await mergedPdf.save();

  return new NextResponse(Buffer.from(mergedBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="SKP-${safeName}.pdf"`,
    },
  });
}

import type { CampaignStatus, PromotionType } from "@/types/database";

// Kuartal fiskal: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Okt–Des,
// Q4 = Jan–Mar tahun kalender berikutnya.

export type FiscalPeriod = { fiscalYear: number; quarter: number };

export function getFiscalPeriod(date: Date): FiscalPeriod {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  if (month >= 4) {
    return { fiscalYear: year, quarter: Math.floor((month - 4) / 3) + 1 };
  }
  return { fiscalYear: year - 1, quarter: 4 };
}

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export type QuarterMonth = { year: number; month: number; label: string };

export function getQuarterMonths(fiscalYear: number, quarter: number): QuarterMonth[] {
  const startMonth = 4 + (quarter - 1) * 3; // Q1→4, Q2→7, Q3→10, Q4→13
  return [0, 1, 2].map((i) => {
    const m = startMonth + i;
    const month = m > 12 ? m - 12 : m;
    const year = m > 12 ? fiscalYear + 1 : fiscalYear;
    return { year, month, label: `${MONTH_NAMES_ID[month - 1]} ${year}` };
  });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function getQuarterDateRange(
  fiscalYear: number,
  quarter: number
): { start: string; endExclusive: string } {
  const months = getQuarterMonths(fiscalYear, quarter);
  const first = months[0];
  const last = months[2];
  const afterYear = last.month === 12 ? last.year + 1 : last.year;
  const afterMonth = last.month === 12 ? 1 : last.month + 1;
  return {
    start: `${first.year}-${pad2(first.month)}-01`,
    endExclusive: `${afterYear}-${pad2(afterMonth)}-01`,
  };
}

// Status komitmen untuk Monitoring Budget: mengikuti rekap manual admin
// (approved penuh) — SENGAJA berbeda dari COMMITTED_CAMPAIGN_STATUSES milik
// Budget Tersisa AA yang meng-commit sejak L1. Jangan disatukan.
export const MONITORING_COMMITTED_STATUSES: readonly CampaignStatus[] = [
  "approved",
  "ongoing",
  "claim_submitted",
  "paid",
  "completed",
];

export type MonitoringCampaign = {
  promotion_category_id: string | null;
  requested_budget: number | null;
  status: CampaignStatus;
  start_date: string | null;
};

export type MonitoringCategory = {
  id: string;
  name: string;
  type: PromotionType;
  account_code: string;
};

export type MonitoringRow = {
  categoryId: string | null; // null untuk baris "Tanpa Kategori"
  accountCode: string | null;
  name: string;
  type: PromotionType | null;
  budget: number;
  months: [number, number, number];
  total: number;
  variance: number; // budget − total
};

export type MonitoringTotals = {
  budget: number;
  months: [number, number, number];
  total: number;
  variance: number;
};

export type MonitoringAggregate = {
  fiscalYear: number;
  quarter: number;
  monthLabels: [string, string, string];
  tpRows: MonitoringRow[];
  cpRows: MonitoringRow[];
  uncategorized: MonitoringRow | null;
  totalTP: MonitoringTotals;
  totalCP: MonitoringTotals;
  grandTotal: MonitoringTotals;
};

function emptyTotals(): MonitoringTotals {
  return { budget: 0, months: [0, 0, 0], total: 0, variance: 0 };
}

function addRow(acc: MonitoringTotals, row: MonitoringRow): void {
  acc.budget += row.budget;
  for (let i = 0; i < 3; i++) acc.months[i] += row.months[i];
  acc.total += row.total;
  acc.variance = acc.budget - acc.total;
}

export function aggregateMonitoringBudget({
  fiscalYear,
  quarter,
  categories,
  budgets,
  campaigns,
}: {
  fiscalYear: number;
  quarter: number;
  categories: MonitoringCategory[];
  budgets: { promotion_category_id: string; total_amount: number }[];
  campaigns: MonitoringCampaign[];
}): MonitoringAggregate {
  const quarterMonths = getQuarterMonths(fiscalYear, quarter);
  const monthKeys = quarterMonths.map(
    (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
  );

  const budgetByCategory = new Map<string, number>();
  for (const b of budgets) {
    budgetByCategory.set(
      b.promotion_category_id,
      (budgetByCategory.get(b.promotion_category_id) ?? 0) + b.total_amount
    );
  }

  // key kategori → [3 bucket bulan]; "" untuk tanpa kategori
  const spendingByCategory = new Map<string, [number, number, number]>();
  for (const c of campaigns) {
    if (!MONITORING_COMMITTED_STATUSES.includes(c.status)) continue;
    if (!c.start_date) continue;
    const monthIndex = monthKeys.indexOf(c.start_date.slice(0, 7));
    if (monthIndex === -1) continue;
    const key = c.promotion_category_id ?? "";
    const buckets = spendingByCategory.get(key) ?? [0, 0, 0];
    buckets[monthIndex] += c.requested_budget ?? 0;
    spendingByCategory.set(key, buckets);
  }

  function buildRow(cat: MonitoringCategory): MonitoringRow {
    const months = spendingByCategory.get(cat.id) ?? [0, 0, 0];
    const total = months[0] + months[1] + months[2];
    const budget = budgetByCategory.get(cat.id) ?? 0;
    return {
      categoryId: cat.id,
      accountCode: cat.account_code,
      name: cat.name,
      type: cat.type,
      budget,
      months,
      total,
      variance: budget - total,
    };
  }

  // Baris = kategori yang punya master budget ATAU punya spending di kuartal ini
  const visible = categories
    .filter(
      (cat) =>
        budgetByCategory.has(cat.id) ||
        (spendingByCategory.get(cat.id) ?? [0, 0, 0]).some((v) => v !== 0)
    )
    .sort((a, b) => a.account_code.localeCompare(b.account_code, "id"));

  const tpRows = visible.filter((c) => c.type === "TP").map(buildRow);
  const cpRows = visible.filter((c) => c.type === "CP").map(buildRow);

  let uncategorized: MonitoringRow | null = null;
  const uncatMonths = spendingByCategory.get("");
  if (uncatMonths && uncatMonths.some((v) => v !== 0)) {
    const total = uncatMonths[0] + uncatMonths[1] + uncatMonths[2];
    uncategorized = {
      categoryId: null,
      accountCode: null,
      name: "Tanpa Kategori",
      type: null,
      budget: 0,
      months: uncatMonths,
      total,
      variance: -total,
    };
  }

  const totalTP = emptyTotals();
  for (const row of tpRows) addRow(totalTP, row);
  const totalCP = emptyTotals();
  for (const row of cpRows) addRow(totalCP, row);

  // Grand total = TP + CP + Tanpa Kategori (di luar kedua subtotal)
  const grandTotal = emptyTotals();
  for (const row of [...tpRows, ...cpRows]) addRow(grandTotal, row);
  if (uncategorized) addRow(grandTotal, uncategorized);

  return {
    fiscalYear,
    quarter,
    monthLabels: [
      quarterMonths[0].label,
      quarterMonths[1].label,
      quarterMonths[2].label,
    ],
    tpRows,
    cpRows,
    uncategorized,
    totalTP,
    totalCP,
    grandTotal,
  };
}

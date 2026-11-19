/**
 * SKP Nasional di laporan (plans/plan-skp-nasional.md, Fase 6).
 *
 * Semua laporan memperlakukan SKP nasional sebagai satu SKP: nilai (komitmen)
 * hanya ada di induk, klaim turunan bernilai Rp0, dan `actual_spent` induk
 * sudah berisi jumlah realisasi turunannya (migrasi 078). Jadi baris turunan
 * tidak boleh ikut dijumlahkan bersama induknya — realisasinya akan terhitung
 * dua kali.
 *
 * - Role internal: baris turunan dibuang (`withoutNationalChildren`, atau
 *   `.is("parent_campaign_id", null)` di query), invoice turunan digabung ke
 *   baris induk (`mergeChildRealizations`).
 * - Distributor: melihat induk dan klaim turunan yang boleh dilihatnya; yang
 *   disembunyikan adalah realisasi gabungan induk (`hideNationalParentSpend`),
 *   karena itu angka semua cabang.
 *
 * Murni, tanpa I/O.
 */

/** Baris laporan tanpa klaim turunan SKP nasional. */
export function withoutNationalChildren<T extends { parent_campaign_id?: string | null }>(
  rows: T[]
): T[] {
  return rows.filter((r) => !r.parent_campaign_id);
}

/**
 * Untuk distributor: realisasi gabungan SKP induk nasional dinolkan (salinan
 * baru, data asal tidak diubah). Realisasi miliknya tetap ada di baris klaim
 * turunannya.
 */
export function hideNationalParentSpend<
  T extends { is_national?: boolean | null; actual_spent: number }
>(rows: T[]): T[] {
  return rows.map((r) => (r.is_national ? { ...r, actual_spent: 0 } : r));
}

/**
 * Menempelkan invoice realisasi klaim turunan ke baris induknya, agar jumlah
 * dan nomor invoice di baris induk sesuai dengan realisasi gabungannya.
 * Turunan yang induknya tidak ada di `parents` diabaikan.
 */
export function mergeChildRealizations<R, P extends { id: string; realizations: R[] | null }>(
  parents: P[],
  children: { parent_campaign_id: string | null; realizations: R[] | null }[]
): (Omit<P, "realizations"> & { realizations: R[] })[] {
  const byParent = new Map<string, R[]>();
  for (const child of children) {
    if (!child.parent_campaign_id) continue;
    const list = byParent.get(child.parent_campaign_id) ?? [];
    list.push(...(child.realizations ?? []));
    byParent.set(child.parent_campaign_id, list);
  }
  return parents.map((p) => ({
    ...p,
    realizations: [...(p.realizations ?? []), ...(byParent.get(p.id) ?? [])],
  }));
}

// ============================================================
// Lembar "Klaim Nasional" di export Excel: satu baris per klaim turunan.
// ============================================================

export const NATIONAL_CLAIM_SHEET_NAME = "Klaim Nasional";

export const NATIONAL_CLAIM_SHEET_HEADERS = [
  "SKP Induk",
  "No. SKP Induk",
  "No. Surat",
  "Perusahaan",
  "Akun",
  "Region",
  "No. Klaim",
  "Nominal Klaim (IDR)",
  "Realisasi (IDR)",
  "Status",
] as const;

export const NATIONAL_CLAIM_SHEET_COL_WIDTHS = [
  { wch: 30 },
  { wch: 20 },
  { wch: 24 },
  { wch: 24 },
  { wch: 24 },
  { wch: 20 },
  { wch: 24 },
  { wch: 20 },
  { wch: 18 },
  { wch: 20 },
];

export type NationalClaimSheetChild = {
  parent_campaign_id: string | null;
  skp_number: string | null;
  child_seq: number | null;
  status: string;
  claim_amount: number | null;
  actual_spent: number | null;
  distributor: { name: string } | null;
  region: { name: string } | null;
  owner_name: string | null;
};

export type NationalClaimSheetParent = {
  id: string;
  name: string;
  skp_number: string | null;
  reference_number?: string | null;
};

export type NationalClaimSheetRow = Record<
  (typeof NATIONAL_CLAIM_SHEET_HEADERS)[number],
  string | number
>;

/**
 * Baris lembar "Klaim Nasional": urut mengikuti urutan `parents`, lalu nomor
 * urut klaim. Nominal klaim kosong selama klaim belum diajukan. Turunan yang
 * induknya tidak ada di `parents` dilewati.
 */
export function buildNationalClaimSheetRows(
  children: NationalClaimSheetChild[],
  parents: NationalClaimSheetParent[],
  statusLabel: (status: string) => string
): NationalClaimSheetRow[] {
  const rows: NationalClaimSheetRow[] = [];
  for (const parent of parents) {
    const own = children
      .filter((c) => c.parent_campaign_id === parent.id)
      .sort((a, b) => (a.child_seq ?? 0) - (b.child_seq ?? 0));
    for (const c of own) {
      rows.push({
        "SKP Induk": parent.name,
        "No. SKP Induk": parent.skp_number ?? "—",
        "No. Surat": parent.reference_number ?? "",
        Perusahaan: c.distributor?.name ?? "",
        Akun: c.owner_name ?? "",
        Region: c.region?.name ?? "",
        "No. Klaim": c.skp_number ?? "—",
        "Nominal Klaim (IDR)": c.claim_amount ?? "",
        "Realisasi (IDR)": c.actual_spent ?? 0,
        Status: statusLabel(c.status),
      });
    }
  }
  return rows;
}

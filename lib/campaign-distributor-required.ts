/**
 * Aturan "Distributor wajib" pada SKP (Multi-User Distributor, Fase 5).
 *
 * SKP departemen Sales dan Trade Marketing hanya terlihat oleh distributor
 * jika `campaigns.distributor_id` terisi (RLS migrasi 067). Karena itu
 * kolom Distributor wajib untuk kedua departemen itu saat SKP diajukan —
 * di klien (form) dan di server (submitCampaignAction) dengan pesan yang
 * sama. Departemen lain (Marketing, Finance, ...) tidak terpengaruh.
 *
 * Modul ini juga menyediakan predikat daftar admin "SKP tanpa distributor":
 * SKP Sales/TM berstatus Disetujui s.d. Selesai yang distributor_id-nya kosong.
 */

import { DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES } from "./campaign-status";
import type { CampaignStatus } from "@/types/database";

export const DISTRIBUTOR_REQUIRED_DEPARTMENTS = ["sales", "trade marketing"] as const;

export const DISTRIBUTOR_REQUIRED_MESSAGE =
  "Distributor wajib diisi untuk SKP Sales / Trade Marketing. SKP tanpa distributor tidak akan terlihat oleh distributor.";

export function isDistributorRequiredDepartment(
  departmentName: string | null | undefined
): boolean {
  if (!departmentName) return false;
  return (DISTRIBUTOR_REQUIRED_DEPARTMENTS as readonly string[]).includes(
    departmentName.trim().toLowerCase()
  );
}

/** Pesan error, atau null jika SKP boleh diajukan tanpa/dengan distributor ini. */
export function distributorRequiredError(
  departmentName: string | null | undefined,
  distributorId: string | null | undefined
): string | null {
  if (!isDistributorRequiredDepartment(departmentName)) return null;
  if (distributorId) return null;
  return DISTRIBUTOR_REQUIRED_MESSAGE;
}

export type CampaignDistributorCheck = {
  distributor_id: string | null | undefined;
  status: string;
  departmentName: string | null | undefined;
};

/** Filter admin `/campaigns?distributor=none`. */
export function isCampaignWithoutDistributor(c: CampaignDistributorCheck): boolean {
  if (c.distributor_id) return false;
  if (!isDistributorRequiredDepartment(c.departmentName)) return false;
  return DISTRIBUTOR_VISIBLE_CAMPAIGN_STATUSES.includes(c.status as CampaignStatus);
}

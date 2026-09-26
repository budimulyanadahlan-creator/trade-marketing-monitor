import { Badge } from "@/components/ui/badge";
import type { PosmStockStatus } from "@/lib/posm";

const STATUS_BADGE: Record<PosmStockStatus, { label: string; variant: "default" | "warning" | "destructive" }> = {
  aman: { label: "Aman", variant: "default" },
  menipis: { label: "Menipis", variant: "warning" },
  habis: { label: "Habis", variant: "destructive" },
};

export const STOCK_STATUS_LABELS: Record<PosmStockStatus, string> = {
  aman: "Aman",
  menipis: "Menipis",
  habis: "Habis",
};

export function StockStatusBadge({ status }: { status: PosmStockStatus }) {
  const { label, variant } = STATUS_BADGE[status];
  return <Badge variant={variant}>{label}</Badge>;
}

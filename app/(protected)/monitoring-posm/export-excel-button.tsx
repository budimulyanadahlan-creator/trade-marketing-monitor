import { Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Unduh workbook Monitoring POSM (route /api/export/monitoring-posm). */
export function ExportExcelButton({ href }: { href: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} download>
        <Sheet className="h-4 w-4" />
        Export Excel
      </a>
    </Button>
  );
}

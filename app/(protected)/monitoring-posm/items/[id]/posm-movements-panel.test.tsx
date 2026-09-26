import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PosmMovementListRow } from "./posm-movements-panel";

const { PosmMovementsPanel } = await import("./posm-movements-panel");

afterEach(() => cleanup());

const movements: PosmMovementListRow[] = [
  { id: "m2", movement_date: "2026-01-20", type: "out", quantity: -30, region_id: "r1", region_name: "Jawa Barat", distributor_id: "d1", distributor_name: "PT Sinar Jaya", campaign_id: "c1", campaign_skp: "SKP/2026/01/0007", campaign_name: "Promo Lebaran", notes: null, created_at: "2026-01-20T00:00:00Z", creator_name: "Rina", running_balance: 70 },
  { id: "m1", movement_date: "2026-01-05", type: "opening", quantity: 100, region_id: null, region_name: null, distributor_id: null, distributor_name: null, campaign_id: null, campaign_skp: null, campaign_name: null, notes: "Stok lama", created_at: "2026-01-05T00:00:00Z", creator_name: "Budi", running_balance: 100 },
];

function renderPanel(canManage: boolean, isActive = true) {
  return render(
    <PosmMovementsPanel
      item={{ id: "i1", unit: "pcs", is_active: isActive }}
      movements={movements}
      regions={[{ id: "r1", name: "Jawa Barat", is_active: true }]}
      distributors={[{ id: "d1", name: "PT Sinar Jaya", is_active: true }]}
      canManage={canManage}
    />
  );
}

describe("PosmMovementsPanel", () => {
  it("shows signed quantities with the running balance", () => {
    renderPanel(false);
    expect(screen.getByText("-30")).toBeTruthy();
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("Saldo Awal")).toBeTruthy();
  });

  it("shows the destination distributor and linked SKP number", () => {
    renderPanel(false);
    expect(screen.getByText("PT Sinar Jaya")).toBeTruthy();
    expect(screen.getByText("SKP/2026/01/0007")).toBeTruthy();
  });

  it("hides every action for readers", () => {
    renderPanel(false);
    expect(screen.queryByText("Catat Mutasi")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Hapus")).toBeNull();
  });

  it("lets writers record, edit and delete movements", () => {
    renderPanel(true);
    expect(screen.getByText("Catat Mutasi")).toBeTruthy();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
    expect(screen.getAllByText("Hapus")).toHaveLength(2);
  });

  it("blocks new movements on an inactive item but keeps corrections", () => {
    renderPanel(true, false);
    expect(screen.queryByText("Catat Mutasi")).toBeNull();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
  });
});

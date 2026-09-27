import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AssetPlacementListRow } from "./asset-placements-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AssetPlacementsPanel } = await import("./asset-placements-panel");

afterEach(() => cleanup());

const base = {
  region_id: null,
  distributor_id: null,
  store_name: null,
  store_address: null,
  region_name: null,
  distributor_name: null,
  pic_name: null,
  notes: null,
  creator_name: "Rina",
  photo_url: null,
};

const warehouse = { destination: "warehouse" as const, store_name: null, region_name: null, distributor_name: null };

// Terbaru lebih dulu, seperti di halaman detail.
const placements: AssetPlacementListRow[] = [
  {
    ...base,
    id: "move",
    event_date: "2026-03-05",
    created_at: "2026-03-05T10:00:00Z",
    destination: "placed",
    region_id: "reg-1",
    region_name: "Jawa Barat",
    store_name: "Toko Maju Jaya",
    pic_name: "Pak Budi",
    condition: "Rusak Ringan",
    is_registration: false,
    photo_url: "https://storage.test/move.jpg",
    previous: warehouse,
  },
  {
    ...base,
    id: "reg",
    event_date: "2026-01-10",
    created_at: "2026-01-10T08:00:00Z",
    destination: "warehouse",
    condition: "Baik",
    is_registration: true,
    previous: null,
  },
];

function renderPanel(canManage: boolean) {
  return render(
    <AssetPlacementsPanel
      asset={{ id: "a1", label: "AST-0001 — Cooler", condition: "Rusak Ringan" }}
      placements={placements}
      regions={[{ id: "reg-1", name: "Jawa Barat", is_active: true }]}
      distributors={[]}
      storeNames={["Toko Maju Jaya"]}
      canManage={canManage}
    />
  );
}

describe("AssetPlacementsPanel", () => {
  it("shows where each move came from and went to, with condition and PIC", () => {
    renderPanel(false);
    const moveRow = screen.getByText("Toko Maju Jaya").closest("tr")!;
    expect(within(moveRow).getByText("Gudang Pusat")).toBeTruthy();
    expect(within(moveRow).getByText("Jawa Barat")).toBeTruthy();
    expect(within(moveRow).getByText("Rusak Ringan")).toBeTruthy();
    expect(within(moveRow).getByText("Pak Budi")).toBeTruthy();
    expect(screen.getByText("Pendaftaran")).toBeTruthy();
  });

  it("hides write actions for readers", () => {
    renderPanel(false);
    expect(screen.queryByText("Pindahkan Asset")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Hapus")).toBeNull();
  });

  it("lets writers edit every record but never delete the registration", () => {
    renderPanel(true);
    expect(screen.getByText("Pindahkan Asset")).toBeTruthy();
    const regRow = screen.getByText("Pendaftaran").closest("tr")!;
    expect(within(regRow).getByText("Edit")).toBeTruthy();
    expect(within(regRow).queryByText("Hapus")).toBeNull();
    const moveRow = screen.getByText("Toko Maju Jaya").closest("tr")!;
    expect(within(moveRow).getByText("Hapus")).toBeTruthy();
  });

  it("shows the proof photo of a placement", () => {
    renderPanel(false);
    const moveRow = screen.getByText("Toko Maju Jaya").closest("tr")!;
    expect(within(moveRow).getByRole("img").getAttribute("src")).toBe("https://storage.test/move.jpg");
    const regRow = screen.getByText("Pendaftaran").closest("tr")!;
    expect(within(regRow).queryByRole("img")).toBeNull();
  });
});

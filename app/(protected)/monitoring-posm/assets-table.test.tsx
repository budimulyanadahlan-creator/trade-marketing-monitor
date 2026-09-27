import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AssetListRow } from "./assets-table";

const { AssetsTable } = await import("./assets-table");

afterEach(() => cleanup());

const brands = [{ id: "brand-1", name: "Produk A", is_active: true }];
const regions = [
  { id: "reg-1", name: "Jawa Barat", is_active: true },
  { id: "reg-2", name: "Bali", is_active: true },
];
const distributors = [{ id: "dist-1", name: "PT Sumber Rejeki", is_active: true }];

const base = {
  brand_id: null,
  brand_name: null,
  serial_number: null,
  acquisition_date: "2026-01-01",
  region_id: null,
  region_name: null,
  distributor_name: null,
  store_name: null,
};

const assets: AssetListRow[] = [
  { ...base, id: "a1", code: "AST-0001", name: "Cooler Showcase", asset_type: "Cooler/Chiller", brand_id: "brand-1", brand_name: "Produk A", acquisition_value: 7_500_000, condition: "Baik", destination: "placed", region_id: "reg-1", region_name: "Jawa Barat", distributor_name: "PT Sumber Rejeki", store_name: "Toko Maju Jaya", can_delete: false },
  { ...base, id: "a2", code: "AST-0002", name: "Rak Display Besi", asset_type: "Rak Display", acquisition_value: 1_200_000, condition: "Rusak Ringan", destination: "warehouse", can_delete: true },
  { ...base, id: "a3", code: "AST-0003", name: "Tenda Lama", asset_type: "Tenda/Booth", acquisition_value: 500_000, condition: "Dihapusbukukan", destination: "warehouse", can_delete: false },
];

function renderTable(canManage: boolean) {
  return render(
    <AssetsTable
      assets={assets}
      brands={brands}
      regions={regions}
      distributors={distributors}
      storeNames={["Toko Maju Jaya"]}
      canManage={canManage}
      suggestedCode="AST-0003"
    />
  );
}

describe("AssetsTable", () => {
  it("shows current location and condition from the latest placement", () => {
    renderTable(false);
    const placedRow = screen.getByText("Cooler Showcase").closest("tr")!;
    expect(within(placedRow).getByText("Toko Maju Jaya")).toBeTruthy();
    expect(within(placedRow).getByText("Jawa Barat • PT Sumber Rejeki")).toBeTruthy();
    const warehouseRow = screen.getByText("Rak Display Besi").closest("tr")!;
    expect(within(warehouseRow).getByText("Gudang Pusat")).toBeTruthy();
    expect(within(warehouseRow).getByText("Rusak Ringan")).toBeTruthy();
  });

  it("hides write actions for readers", () => {
    renderTable(false);
    expect(screen.queryByText("Daftarkan Asset")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Hapus")).toBeNull();
    expect(screen.queryByText("Pindahkan")).toBeNull();
  });

  it("links each asset to its detail page", () => {
    renderTable(false);
    expect(screen.getByText("Cooler Showcase").closest("a")?.getAttribute("href")).toBe("/monitoring-posm/assets/a1");
  });

  it("offers a move action for every asset to writers", () => {
    renderTable(true);
    expect(within(screen.getByText("Cooler Showcase").closest("tr")!).getByText("Pindahkan")).toBeTruthy();
    expect(within(screen.getByText("Rak Display Besi").closest("tr")!).getByText("Pindahkan")).toBeTruthy();
  });

  it("hides written-off assets by default and shows them on request", () => {
    renderTable(false);
    expect(screen.queryByText("Tenda Lama")).toBeNull();
    expect(screen.getByText(/1 dihapusbukukan disembunyikan/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter kondisi"), { target: { value: "all" } });
    expect(screen.getByText("Tenda Lama")).toBeTruthy();
    expect(screen.getByText("Cooler Showcase")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter kondisi"), { target: { value: "Dihapusbukukan" } });
    expect(screen.getByText("Tenda Lama")).toBeTruthy();
    expect(screen.queryByText("Cooler Showcase")).toBeNull();
  });

  it("offers delete only for assets that just have their registration", () => {
    renderTable(true);
    expect(screen.getByText("Daftarkan Asset")).toBeTruthy();
    expect(within(screen.getByText("Cooler Showcase").closest("tr")!).queryByText("Hapus")).toBeNull();
    expect(within(screen.getByText("Rak Display Besi").closest("tr")!).getByText("Hapus")).toBeTruthy();
  });

  it("filters by condition and region", () => {
    renderTable(false);
    fireEvent.change(screen.getByLabelText("Filter kondisi"), { target: { value: "Rusak Ringan" } });
    expect(screen.queryByText("Cooler Showcase")).toBeNull();
    expect(screen.getByText("Rak Display Besi")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter kondisi"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter region"), { target: { value: "reg-1" } });
    expect(screen.getByText("Cooler Showcase")).toBeTruthy();
    expect(screen.queryByText("Rak Display Besi")).toBeNull();
  });
});

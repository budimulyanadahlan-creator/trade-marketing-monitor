import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AssetListRow } from "./assets-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AssetsTable } = await import("./assets-table");

afterEach(() => cleanup());

const assetTypes = [
  { id: "type-cooler", name: "Cooler/Chiller", is_active: true },
  { id: "type-rak", name: "Rak Display", is_active: true },
  { id: "type-tenda", name: "Tenda/Booth", is_active: false },
  { id: "type-seragam", name: "Seragam/Pakaian", is_active: true },
];
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
  photo_url: null,
};

const assets: AssetListRow[] = [
  { ...base, id: "a1", code: "AST-0001", name: "Cooler Showcase", asset_type_id: "type-cooler", asset_type_name: "Cooler/Chiller", brand_id: "brand-1", brand_name: "Produk A", acquisition_value: 7_500_000, condition: "Baik", destination: "placed", region_id: "reg-1", region_name: "Jawa Barat", distributor_name: "PT Sumber Rejeki", store_name: "Toko Maju Jaya", can_delete: false, photo_url: "https://storage.test/a1.jpg" },
  { ...base, id: "a2", code: "AST-0002", name: "Rak Display Besi", asset_type_id: "type-rak", asset_type_name: "Rak Display", acquisition_value: 1_200_000, condition: "Rusak Ringan", destination: "warehouse", can_delete: true },
  { ...base, id: "a3", code: "AST-0003", name: "Tenda Lama", asset_type_id: "type-tenda", asset_type_name: "Tenda/Booth", acquisition_value: 500_000, condition: "Dihapusbukukan", destination: "warehouse", can_delete: false },
];

function renderTable(canManage: boolean, initialView: "daftar" | "ringkasan" = "daftar") {
  return render(
    <AssetsTable
      assets={assets}
      assetTypes={assetTypes}
      brands={brands}
      regions={regions}
      distributors={distributors}
      storeNames={["Toko Maju Jaya"]}
      canManage={canManage}
      suggestedCode="AST-0003"
      initialView={initialView}
    />
  );
}

describe("AssetsTable", () => {
  it("shows the asset type name from the asset_types master", () => {
    renderTable(false);
    expect(within(screen.getByText("Cooler Showcase").closest("tr")!).getByText("Cooler/Chiller")).toBeTruthy();
  });

  it("filters by asset type id, listing every type including inactive ones", () => {
    renderTable(false);
    const filter = screen.getByLabelText("Filter jenis") as HTMLSelectElement;
    expect([...filter.options].map((o) => o.text)).toEqual([
      "Semua jenis",
      "Cooler/Chiller",
      "Rak Display",
      "Tenda/Booth",
      "Seragam/Pakaian",
    ]);
    fireEvent.change(filter, { target: { value: "type-rak" } });
    expect(screen.getByText("Rak Display Besi")).toBeTruthy();
    expect(screen.queryByText("Cooler Showcase")).toBeNull();
  });

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

  it("shows a photo thumbnail that enlarges on click, only for assets with a photo", () => {
    renderTable(false);
    const thumbs = screen.getAllByTitle("Perbesar foto");
    expect(thumbs).toHaveLength(1);
    expect(within(screen.getByText("Cooler Showcase").closest("tr")!).getByTitle("Perbesar foto")).toBeTruthy();

    fireEvent.click(thumbs[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe("https://storage.test/a1.jpg");
  });
});

describe("AssetsTable — Ringkasan Stok", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  const summaryRow = (label: string) => screen.getByRole("button", { name: new RegExp(label) }).closest("tr")!;
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell").slice(1).map((c) => c.textContent);

  it("switches to the summary and keeps view=ringkasan in the URL", () => {
    window.history.replaceState(null, "", "/monitoring-posm?tab=asset");
    renderTable(false);
    fireEvent.click(screen.getByRole("button", { name: "Ringkasan Stok" }));
    expect(window.location.search).toBe("?tab=asset&view=ringkasan");
    expect(screen.queryByLabelText("Filter jenis")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Daftar Unit" }));
    expect(window.location.search).toBe("?tab=asset");
    expect(screen.getByText("Cooler Showcase")).toBeTruthy();
  });

  it("summarises per type with a total row, hiding written-off units by default", () => {
    renderTable(false, "ringkasan");
    expect(cells(summaryRow("Cooler/Chiller"))).toEqual(["1", "0", "1", "0", "0", expect.stringContaining("7.500.000")]);
    expect(cells(summaryRow("Rak Display"))).toEqual(["1", "1", "0", "1", "0", expect.stringContaining("1.200.000")]);
    expect(screen.queryByText(/Tenda\/Booth/)).toBeNull();
    const totalRow = screen.getByText("Total", { selector: "td" }).closest("tr")!;
    expect(cells(totalRow).slice(0, 4)).toEqual(["2", "1", "1", "1"]);
  });

  it("expands a type into rows per asset name", () => {
    renderTable(false, "ringkasan");
    expect(screen.queryByText("Cooler Showcase")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cooler\/Chiller/ }));
    expect(cells(screen.getByText("Cooler Showcase").closest("tr")!)[0]).toBe("1");
  });

  it("applies the region filter so only units placed there are counted", () => {
    renderTable(false, "ringkasan");
    fireEvent.change(screen.getByLabelText("Filter region"), { target: { value: "reg-1" } });
    expect(screen.queryByText(/Rak Display/)).toBeNull();
    const totalRow = screen.getByText("Total", { selector: "td" }).closest("tr")!;
    expect(cells(totalRow).slice(0, 3)).toEqual(["1", "0", "1"]);
  });
});

describe("AssetsTable — tautan Ringkasan Stok ke Daftar Unit", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  const summaryRow = (label: string) => screen.getByRole("button", { name: new RegExp(label) }).closest("tr")!;
  const countCell = (row: HTMLElement, index: number) => within(row).getAllByRole("cell")[index + 1];
  const listedNames = () =>
    screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/monitoring-posm/assets/"))
      .map((a) => a.textContent);

  it("opens the unit list filtered by type and location when a number is clicked", () => {
    window.history.replaceState(null, "", "/monitoring-posm?tab=asset&view=ringkasan");
    renderTable(false, "ringkasan");
    const link = within(countCell(summaryRow("Cooler/Chiller"), 2)).getByRole("link");
    expect(link.getAttribute("href")).toBe("/monitoring-posm?tab=asset&jenis=type-cooler&lokasi=placed");

    fireEvent.click(link);
    expect(listedNames()).toEqual(["Cooler Showcase"]);
    expect((screen.getByLabelText("Filter jenis") as HTMLSelectElement).value).toBe("type-cooler");
    expect((screen.getByLabelText("Filter lokasi") as HTMLSelectElement).value).toBe("placed");
    expect(window.location.search).toBe("?tab=asset&jenis=type-cooler&lokasi=placed");
  });

  it("does not link zero counts", () => {
    renderTable(false, "ringkasan");
    expect(within(countCell(summaryRow("Cooler/Chiller"), 1)).queryByRole("link")).toBeNull();
  });

  it("adds a removable exact-name chip when a name row number is clicked", () => {
    window.history.replaceState(null, "", "/monitoring-posm?tab=asset&view=ringkasan");
    renderTable(false, "ringkasan");
    fireEvent.click(screen.getByRole("button", { name: /Rak Display/ }));
    fireEvent.click(within(countCell(screen.getByText("Rak Display Besi").closest("tr")!, 0)).getByRole("link"));
    expect(screen.getByText("Nama: Rak Display Besi")).toBeTruthy();
    expect(listedNames()).toEqual(["Rak Display Besi"]);

    fireEvent.click(screen.getByRole("button", { name: "Hapus filter nama" }));
    expect(screen.queryByText(/Nama: /)).toBeNull();
    expect(window.location.search).toBe("?tab=asset&jenis=type-rak");
    expect(listedNames()).toEqual(["Rak Display Besi"]);
  });

  it("shows both damaged conditions when the Rusak number is clicked", () => {
    renderTable(false, "ringkasan");
    const totalRow = screen.getByText("Total", { selector: "td" }).closest("tr")!;
    fireEvent.click(within(countCell(totalRow, 3)).getByRole("link"));
    expect((screen.getByLabelText("Filter kondisi") as HTMLSelectElement).value).toBe("rusak");
    expect(listedNames()).toEqual(["Rak Display Besi"]);
  });

  it("starts from filters read from the URL", () => {
    render(
      <AssetsTable
        assets={assets}
        assetTypes={assetTypes}
        brands={brands}
        regions={regions}
        distributors={distributors}
        storeNames={[]}
        canManage={false}
        suggestedCode="AST-0004"
        initialFilters={{ typeId: "", name: "Tenda Lama", brandId: "", regionId: "", condition: "all", location: "warehouse" }}
      />
    );
    expect(screen.getByText("Nama: Tenda Lama")).toBeTruthy();
    expect(listedNames()).toEqual(["Tenda Lama"]);
  });
});

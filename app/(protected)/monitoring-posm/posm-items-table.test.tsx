import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PosmItemListRow } from "./posm-items-table";

const { PosmItemsTable } = await import("./posm-items-table");

afterEach(() => cleanup());

const brands = [
  { id: "brand-1", name: "Produk A", is_active: true },
  { id: "brand-2", name: "Produk B", is_active: true },
];

const items: PosmItemListRow[] = [
  { id: "i1", code: "POSM-0001", name: "Wobbler Lebaran", brand_id: "brand-1", brand_name: "Produk A", category: "Wobbler", unit: "pcs", min_stock: 50, is_active: true },
  { id: "i2", code: "POSM-0002", name: "Poster Ramadan", brand_id: "brand-2", brand_name: "Produk B", category: "Poster", unit: "lembar", min_stock: null, is_active: true },
  { id: "i3", code: "POSM-0003", name: "Hanger Lama", brand_id: null, brand_name: null, category: "Hanger", unit: "pcs", min_stock: null, is_active: false },
];

function renderTable(canManage: boolean) {
  return render(
    <PosmItemsTable items={items} brands={brands} canManage={canManage} suggestedCode="POSM-0004" />
  );
}

describe("PosmItemsTable", () => {
  it("shows only active items by default", () => {
    renderTable(false);
    expect(screen.getByText("Wobbler Lebaran")).toBeTruthy();
    expect(screen.getByText("Poster Ramadan")).toBeTruthy();
    expect(screen.queryByText("Hanger Lama")).toBeNull();
  });

  it("shows inactive items through the status filter", () => {
    renderTable(false);
    fireEvent.change(screen.getByLabelText("Filter status"), { target: { value: "inactive" } });
    expect(screen.getByText("Hanger Lama")).toBeTruthy();
    expect(screen.queryByText("Wobbler Lebaran")).toBeNull();
  });

  it("filters by brand and category", () => {
    renderTable(false);
    fireEvent.change(screen.getByLabelText("Filter brand"), { target: { value: "brand-2" } });
    expect(screen.getByText("Poster Ramadan")).toBeTruthy();
    expect(screen.queryByText("Wobbler Lebaran")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter kategori"), { target: { value: "Wobbler" } });
    expect(screen.getByText("Tidak ada item yang cocok dengan filter.")).toBeTruthy();
  });

  it("searches by code", () => {
    renderTable(false);
    fireEvent.change(screen.getByPlaceholderText("Cari kode, nama, atau brand..."), {
      target: { value: "posm-0002" },
    });
    expect(screen.getByText("Poster Ramadan")).toBeTruthy();
    expect(screen.queryByText("Wobbler Lebaran")).toBeNull();
  });

  it("hides every action button for readers", () => {
    renderTable(false);
    expect(screen.queryByText("Tambah Item")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Hapus")).toBeNull();
    expect(screen.queryByText("Aksi")).toBeNull();
  });

  it("shows add, edit, deactivate and delete for writers", () => {
    renderTable(true);
    expect(screen.getByText("Tambah Item")).toBeTruthy();
    expect(screen.getAllByText("Edit")).toHaveLength(2);
    expect(screen.getAllByText("Nonaktifkan")).toHaveLength(2);
    expect(screen.getAllByText("Hapus")).toHaveLength(2);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GimmickItemListRow } from "./gimmick-items-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { GimmickItemsTable } = await import("./gimmick-items-table");

afterEach(() => cleanup());

const base = { brand_id: null, brand_name: null, suggested_price: null, min_stock: null, has_movements: false, photo_url: null };
const noStock = { balance: 0, stock_value: 0, stock_status: "habis" as const, last_movement_date: null };

const items: GimmickItemListRow[] = [
  { ...base, id: "g1", code: "GMK-0001", name: "Payung Wangzai", category: "Payung", unit: "pcs", pcs_per_carton: 24, unit_cost: 45000, program: "Imlek 2027", is_active: true, has_movements: true, balance: 77, stock_value: 77 * 45000, stock_status: "aman", last_movement_date: "2026-09-01" },
  { ...base, ...noStock, id: "g2", code: "GMK-0002", name: "Tas Kanvas Merah", category: "Tas", unit: "pcs", pcs_per_carton: 80, unit_cost: 12500, program: "Lebaran 2027", is_active: true },
  { ...base, ...noStock, id: "g3", code: "GMK-0003", name: "Gelas Sedotan Lama", category: "Botol/Gelas", unit: "pcs", pcs_per_carton: null, unit_cost: 8000, program: null, is_active: false },
];

function renderTable() {
  return render(<GimmickItemsTable items={items} brands={[]} suggestedCode="GMK-0004" />);
}

describe("GimmickItemsTable", () => {
  it("shows active items with the balance in pcs + cartons, unit cost and stock value", () => {
    renderTable();
    expect(screen.getByText("Payung Wangzai").closest("a")?.getAttribute("href")).toBe("/monitoring-posm/gimmick/items/g1");
    expect(screen.getByText("77 pcs (3 krt + 5 pcs)")).toBeTruthy();
    expect(screen.getByText(/45\.000/)).toBeTruthy();
    expect(screen.getByText(/3\.465\.000/)).toBeTruthy();
    expect(screen.queryByText("Gelas Sedotan Lama")).toBeNull();
  });

  it("filters by stock status and hides delete for items with movements", () => {
    renderTable();
    fireEvent.change(screen.getByLabelText("Filter stok"), { target: { value: "habis" } });
    expect(screen.getByText("Tas Kanvas Merah")).toBeTruthy();
    expect(screen.queryByText("Payung Wangzai")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter stok"), { target: { value: "" } });
    expect(screen.getAllByText("Hapus")).toHaveLength(1);
  });

  it("filters by program and by status", () => {
    renderTable();
    fireEvent.change(screen.getByLabelText("Filter program"), { target: { value: "Lebaran 2027" } });
    expect(screen.getByText("Tas Kanvas Merah")).toBeTruthy();
    expect(screen.queryByText("Payung Wangzai")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter program"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter status"), { target: { value: "inactive" } });
    expect(screen.getByText("Gelas Sedotan Lama")).toBeTruthy();
    expect(screen.queryByText("Payung Wangzai")).toBeNull();
  });

  it("searches by program name", () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText("Cari kode, nama, atau program..."), {
      target: { value: "imlek" },
    });
    expect(screen.getByText("Payung Wangzai")).toBeTruthy();
    expect(screen.queryByText("Tas Kanvas Merah")).toBeNull();
  });

  it("offers existing programs as autocomplete in the add dialog, with the next code", () => {
    renderTable();
    fireEvent.click(screen.getByText("Tambah Item"));
    expect((screen.getByLabelText("Kode") as HTMLInputElement).value).toBe("GMK-0004");
    const program = screen.getByLabelText("Program / Periode (opsional)") as HTMLInputElement;
    const options = [...document.getElementById(program.getAttribute("list")!)!.querySelectorAll("option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["Imlek 2027", "Lebaran 2027"]);
  });
});

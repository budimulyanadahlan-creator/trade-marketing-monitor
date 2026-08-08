import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BrandRow } from "@/types/database";

const { BrandsTable } = await import("./brands-table");

afterEach(() => cleanup());

const brands: BrandRow[] = [
  { id: "brand-1", name: "Produk A", code: "PRODA", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "brand-2", name: "Produk B", code: "PRODB", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
];

describe("BrandsTable search", () => {
  it("shows the full count and all rows with no search active", () => {
    render(<BrandsTable brands={brands} />);
    expect(screen.getByText("2 brand terdaftar")).toBeTruthy();
    expect(screen.getByText("Produk A")).toBeTruthy();
    expect(screen.getByText("Produk B")).toBeTruthy();
  });

  it("filters rows by name as the user types", () => {
    render(<BrandsTable brands={brands} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode brand...");
    fireEvent.change(input, { target: { value: "produk a" } });

    expect(screen.getByText("1 brand terdaftar")).toBeTruthy();
    expect(screen.getByText("Produk A")).toBeTruthy();
    expect(screen.queryByText("Produk B")).toBeNull();
  });

  it("filters rows by code", () => {
    render(<BrandsTable brands={brands} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode brand...");
    fireEvent.change(input, { target: { value: "prodb" } });

    expect(screen.getByText("Produk B")).toBeTruthy();
    expect(screen.queryByText("Produk A")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<BrandsTable brands={brands} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode brand...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(screen.queryByText("Belum ada brand. Tambah brand pertama Anda.")).toBeNull();
  });

  it("shows the empty-list message (not the no-results message) when there are truly no brands", () => {
    render(<BrandsTable brands={[]} />);
    expect(screen.getByText("Belum ada brand. Tambah brand pertama Anda.")).toBeTruthy();
  });
});

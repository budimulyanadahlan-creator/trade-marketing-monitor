import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PromotionCategoryRow } from "@/types/database";

const { CategoriesTable } = await import("./categories-table");

afterEach(() => cleanup());

const categories: PromotionCategoryRow[] = [
  { id: "cat-1", name: "Trade Promo 1", type: "TP", account_code: "TP1", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "cat-2", name: "Consumer Promo 1", type: "CP", account_code: "CP1", is_active: true, created_at: "2026-01-01T00:00:00.000Z" },
];

describe("CategoriesTable search", () => {
  it("shows the full count and all rows with no search active", () => {
    render(<CategoriesTable categories={categories} />);
    expect(screen.getByText("2 kategori terdaftar")).toBeTruthy();
    expect(screen.getByText("Trade Promo 1")).toBeTruthy();
    expect(screen.getByText("Consumer Promo 1")).toBeTruthy();
  });

  it("filters rows by name as the user types", () => {
    render(<CategoriesTable categories={categories} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode akun...");
    fireEvent.change(input, { target: { value: "trade" } });

    expect(screen.getByText("1 kategori terdaftar")).toBeTruthy();
    expect(screen.getByText("Trade Promo 1")).toBeTruthy();
    expect(screen.queryByText("Consumer Promo 1")).toBeNull();
  });

  it("filters rows by account_code", () => {
    render(<CategoriesTable categories={categories} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode akun...");
    fireEvent.change(input, { target: { value: "cp1" } });

    expect(screen.getByText("Consumer Promo 1")).toBeTruthy();
    expect(screen.queryByText("Trade Promo 1")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<CategoriesTable categories={categories} />);
    const input = screen.getByPlaceholderText("Cari nama atau kode akun...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(screen.queryByText("Belum ada kategori promosi. Tambah kategori pertama Anda.")).toBeNull();
  });

  it("shows the empty-list message (not the no-results message) when there are truly no categories", () => {
    render(<CategoriesTable categories={[]} />);
    expect(screen.getByText("Belum ada kategori promosi. Tambah kategori pertama Anda.")).toBeTruthy();
  });
});

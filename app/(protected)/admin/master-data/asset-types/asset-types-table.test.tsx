import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/actions/master-data", () => ({
  saveAssetTypeAction: vi.fn(),
  toggleAssetTypeActiveAction: vi.fn(),
  deleteAssetTypeAction: vi.fn(),
}));

const { AssetTypesTable } = await import("./asset-types-table");
import type { AssetTypeListRow } from "./asset-types-table";

afterEach(() => cleanup());

const assetTypes: AssetTypeListRow[] = [
  { id: "t1", name: "Gondola", is_active: true, created_at: "2026-01-01T00:00:00.000Z", asset_count: 4 },
  { id: "t2", name: "Seragam/Pakaian", is_active: false, created_at: "2026-01-01T00:00:00.000Z", asset_count: 0 },
];

describe("AssetTypesTable", () => {
  it("lists types with status and usage count", () => {
    render(<AssetTypesTable assetTypes={assetTypes} />);
    expect(screen.getByText("2 jenis asset terdaftar")).toBeTruthy();
    expect(screen.getByText("Gondola")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Nonaktif")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aktifkan" })).toBeTruthy();
  });

  it("filters by name", () => {
    render(<AssetTypesTable assetTypes={assetTypes} />);
    fireEvent.change(screen.getByPlaceholderText("Cari jenis asset..."), { target: { value: "seragam" } });
    expect(screen.getByText("1 jenis asset terdaftar")).toBeTruthy();
    expect(screen.queryByText("Gondola")).toBeNull();
  });

  // Saat dialog terbuka, tombol pemicu di belakangnya disembunyikan dari aksesibilitas.
  it("explains that a type in use cannot be deleted and offers no delete button", () => {
    render(<AssetTypesTable assetTypes={[assetTypes[0]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(screen.getByText(/sudah dipakai\s+4 asset sehingga tidak bisa dihapus/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hapus" })).toBeNull();
  });

  it("asks for confirmation when deleting an unused type", () => {
    render(<AssetTypesTable assetTypes={[assetTypes[1]]} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(screen.getByText(/Yakin ingin menghapus jenis/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hapus" })).toBeTruthy();
  });
});

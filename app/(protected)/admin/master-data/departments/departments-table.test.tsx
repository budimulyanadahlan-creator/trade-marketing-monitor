import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DepartmentRow } from "@/types/database";

const { DepartmentsTable } = await import("./departments-table");

afterEach(() => cleanup());

const departments: DepartmentRow[] = [
  { id: "dept-1", name: "Sales" },
  { id: "dept-2", name: "Marketing" },
];

describe("DepartmentsTable search", () => {
  it("shows the full count and all rows with no search active", () => {
    render(<DepartmentsTable departments={departments} />);
    expect(screen.getByText("2 departemen terdaftar")).toBeTruthy();
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getByText("Marketing")).toBeTruthy();
  });

  it("filters rows by name as the user types", () => {
    render(<DepartmentsTable departments={departments} />);
    const input = screen.getByPlaceholderText("Cari nama departemen...");
    fireEvent.change(input, { target: { value: "sales" } });

    expect(screen.getByText("1 departemen terdaftar")).toBeTruthy();
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.queryByText("Marketing")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<DepartmentsTable departments={departments} />);
    const input = screen.getByPlaceholderText("Cari nama departemen...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(screen.queryByText("Belum ada departemen. Tambah departemen pertama Anda.")).toBeNull();
  });

  it("shows the empty-list message (not the no-results message) when there are truly no departments", () => {
    render(<DepartmentsTable departments={[]} />);
    expect(screen.getByText("Belum ada departemen. Tambah departemen pertama Anda.")).toBeTruthy();
  });

  it("clears the search and restores the full list via the clear button", () => {
    render(<DepartmentsTable departments={departments} />);
    const input = screen.getByPlaceholderText("Cari nama departemen...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sales" } });
    expect(screen.getByText("1 departemen terdaftar")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Hapus pencarian"));

    expect(input.value).toBe("");
    expect(screen.getByText("2 departemen terdaftar")).toBeTruthy();
    expect(screen.getByText("Marketing")).toBeTruthy();
  });
});

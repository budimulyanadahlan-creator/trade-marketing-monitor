import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UserRow, DepartmentRow, RegionRow } from "@/types/database";

vi.mock("@/lib/email", () => ({ sendPasswordResetNotificationEmail: vi.fn() }));

const { UsersClient } = await import("./users-client");

afterEach(() => cleanup());

type UserWithDepartment = UserRow & {
  departments: Pick<DepartmentRow, "name"> | null;
  regions: Pick<RegionRow, "name"> | null;
  distributors: null;
};

function makeUser(overrides: Partial<UserWithDepartment>): UserWithDepartment {
  return {
    id: "user-1",
    full_name: "Budi Santoso",
    role: "user",
    is_active: true,
    department_id: "dept-1",
    region_id: "region-1",
    distributor_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    departments: { name: "Marketing" },
    regions: { name: "Jawa Barat" },
    distributors: null,
    ...overrides,
  } as UserWithDepartment;
}

const users: UserWithDepartment[] = [
  makeUser({ id: "user-1", full_name: "Budi Santoso", departments: { name: "Marketing" }, regions: { name: "Jawa Barat" } }),
  makeUser({ id: "user-2", full_name: "Citra Dewi", departments: { name: "Sales" }, regions: { name: "Sumatra" } }),
];

const baseProps = {
  currentUserId: "actor-id",
  actorRole: "superadmin" as const,
  departments: [],
  regions: [],
  distributors: [],
};

describe("UsersClient search", () => {
  it("shows the full user count with no search active", () => {
    render(<UsersClient users={users} {...baseProps} />);
    expect(screen.getByText("2 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Budi Santoso")).toBeTruthy();
    expect(screen.getByText("Citra Dewi")).toBeTruthy();
  });

  it("filters rows by name as the user types", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, atau region...");
    fireEvent.change(input, { target: { value: "budi" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Budi Santoso")).toBeTruthy();
    expect(screen.queryByText("Citra Dewi")).toBeNull();
  });

  it("filters rows by department name", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, atau region...");
    fireEvent.change(input, { target: { value: "sales" } });

    expect(screen.getByText("Citra Dewi")).toBeTruthy();
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("filters rows by region name", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, atau region...");
    fireEvent.change(input, { target: { value: "sumatra" } });

    expect(screen.getByText("Citra Dewi")).toBeTruthy();
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, atau region...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(screen.queryByText("Belum ada user. Tambah user pertama Anda.")).toBeNull();
  });

  it("shows the empty-list message (not the no-results message) when there are truly no users", () => {
    render(<UsersClient users={[]} {...baseProps} />);
    expect(screen.getByText("Belum ada user. Tambah user pertama Anda.")).toBeTruthy();
  });

  it("clears the search and restores the full list via the clear button", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, atau region...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "budi" } });
    expect(screen.getByText("1 user terdaftar")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Hapus pencarian"));

    expect(input.value).toBe("");
    expect(screen.getByText("2 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Citra Dewi")).toBeTruthy();
  });
});

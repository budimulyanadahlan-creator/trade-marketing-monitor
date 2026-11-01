import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { UserRow, DepartmentRow, RegionRow, DistributorRow } from "@/types/database";

vi.mock("@/lib/email", () => ({ sendPasswordResetNotificationEmail: vi.fn() }));

const { UsersClient } = await import("./users-client");

afterEach(() => cleanup());

type UserWithDepartment = UserRow & {
  departments: Pick<DepartmentRow, "name"> | null;
  regions: Pick<RegionRow, "name"> | null;
  distributors: Pick<DistributorRow, "name"> | null;
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
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...");
    fireEvent.change(input, { target: { value: "budi" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Budi Santoso")).toBeTruthy();
    expect(screen.queryByText("Citra Dewi")).toBeNull();
  });

  it("filters rows by department name", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...");
    fireEvent.change(input, { target: { value: "sales" } });

    expect(screen.getByText("Citra Dewi")).toBeTruthy();
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("filters rows by region name", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...");
    fireEvent.change(input, { target: { value: "sumatra" } });

    expect(screen.getByText("Citra Dewi")).toBeTruthy();
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<UsersClient users={users} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...");
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
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "budi" } });
    expect(screen.getByText("1 user terdaftar")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Hapus pencarian"));

    expect(input.value).toBe("");
    expect(screen.getByText("2 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Citra Dewi")).toBeTruthy();
  });
});

// -------------------------------------------------------
// Kolom + filter Perusahaan dan Cakupan (Fase 2 multi-user distributor)
// -------------------------------------------------------

const edmId = "edm-id";
const mmsId = "mms-id";

const distributorUsers: UserWithDepartment[] = [
  makeUser({
    id: "d-1",
    full_name: "Pusat EDM",
    role: "distributor",
    distributor_id: edmId,
    distributor_scope: "pusat",
    distributors: { name: "Esham Dima" },
  }),
  makeUser({
    id: "d-2",
    full_name: "Cabang EDM",
    role: "distributor",
    distributor_id: edmId,
    distributor_scope: "cabang",
    distributors: { name: "Esham Dima" },
  }),
  makeUser({
    id: "d-3",
    full_name: "Cabang MMS",
    role: "distributor",
    distributor_id: mmsId,
    distributor_scope: "cabang",
    distributors: { name: "Mitra Monas Sejahtera" },
  }),
  makeUser({
    id: "d-4",
    full_name: "Distributor Yatim",
    role: "distributor",
    is_active: false,
    distributor_id: null,
    distributor_scope: null,
    distributors: null,
  }),
  makeUser({ id: "u-1", full_name: "Budi Santoso", role: "user" }),
];

const distributorProps = {
  ...baseProps,
  distributors: [
    { id: edmId, name: "Esham Dima" },
    { id: mmsId, name: "Mitra Monas Sejahtera" },
  ],
};

describe("UsersClient perusahaan & cakupan", () => {
  it("shows company and scope columns per user", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    expect(screen.getByText("Perusahaan")).toBeTruthy();
    expect(screen.getByText("Cakupan")).toBeTruthy();
    expect(screen.getAllByText("Esham Dima").length).toBeGreaterThanOrEqual(2);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Pusat")).toBeTruthy();
    expect(within(table).getAllByText("Cabang").length).toBe(2);
    expect(screen.getByText("Belum ada")).toBeTruthy();
  });

  it("filters by company", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    fireEvent.change(screen.getByLabelText("Filter perusahaan"), { target: { value: mmsId } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Cabang MMS")).toBeTruthy();
    expect(screen.queryByText("Cabang EDM")).toBeNull();
    expect(screen.queryByText("Budi Santoso")).toBeNull();
  });

  it("filters by scope", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    fireEvent.change(screen.getByLabelText("Filter cakupan"), { target: { value: "pusat" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Pusat EDM")).toBeTruthy();
    expect(screen.queryByText("Cabang EDM")).toBeNull();
  });

  it("combines company and scope filters", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    fireEvent.change(screen.getByLabelText("Filter perusahaan"), { target: { value: edmId } });
    fireEvent.change(screen.getByLabelText("Filter cakupan"), { target: { value: "cabang" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Cabang EDM")).toBeTruthy();
  });

  it("lists only orphan distributor accounts with the 'tanpa perusahaan' option", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    fireEvent.change(screen.getByLabelText("Filter perusahaan"), { target: { value: "none" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Distributor Yatim")).toBeTruthy();
  });

  it("searches by company name", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    const input = screen.getByPlaceholderText("Cari nama, departemen, region, atau perusahaan...");
    fireEvent.change(input, { target: { value: "monas" } });

    expect(screen.getByText("1 user terdaftar")).toBeTruthy();
    expect(screen.getByText("Cabang MMS")).toBeTruthy();
  });

  it("disables the activate button for an inactive distributor without a company", () => {
    render(<UsersClient users={distributorUsers} {...distributorProps} />);
    const button = screen.getByRole("button", { name: "Aktifkan" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/belum punya perusahaan/);
  });
});

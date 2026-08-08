import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { ActionApprovalsTable } = await import("./action-approvals-table");

afterEach(() => cleanup());

function makeAA(overrides: Record<string, unknown>) {
  return {
    id: "aa-1",
    name: "Action Approval Q1 2025",
    master_budget_id: null,
    brand_id: null,
    start_date: "2025-01-01",
    end_date: "2025-03-31",
    target_budget: 1000000,
    budget_tersisa: 500000,
    created_at: "2026-01-01T00:00:00.000Z",
    master_budget: null,
    brand: null,
    ...overrides,
  };
}

const actionApprovals = [
  makeAA({ id: "aa-1", name: "Action Approval Q1 2025" }),
  makeAA({ id: "aa-2", name: "Action Approval Q2 2025" }),
];

const baseProps = {
  masterBudgets: [],
  brands: [],
  campaignsByAA: {},
};

describe("ActionApprovalsTable search", () => {
  it("shows the full count and all rows with no search active", () => {
    render(<ActionApprovalsTable actionApprovals={actionApprovals} {...baseProps} />);
    expect(screen.getByText("2 action approval terdaftar")).toBeTruthy();
    expect(screen.getByText("Action Approval Q1 2025")).toBeTruthy();
    expect(screen.getByText("Action Approval Q2 2025")).toBeTruthy();
  });

  it("filters rows by name as the user types", () => {
    render(<ActionApprovalsTable actionApprovals={actionApprovals} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama action approval...");
    fireEvent.change(input, { target: { value: "q1" } });

    expect(screen.getByText("1 action approval terdaftar")).toBeTruthy();
    expect(screen.getByText("Action Approval Q1 2025")).toBeTruthy();
    expect(screen.queryByText("Action Approval Q2 2025")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(<ActionApprovalsTable actionApprovals={actionApprovals} {...baseProps} />);
    const input = screen.getByPlaceholderText("Cari nama action approval...");
    fireEvent.change(input, { target: { value: "zzz" } });

    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(
      screen.queryByText("Belum ada Action Approval. Tambah Action Approval pertama Anda.")
    ).toBeNull();
  });

  it("shows the empty-list message (not the no-results message) when there are truly no action approvals", () => {
    render(<ActionApprovalsTable actionApprovals={[]} {...baseProps} />);
    expect(
      screen.getByText("Belum ada Action Approval. Tambah Action Approval pertama Anda.")
    ).toBeTruthy();
  });
});

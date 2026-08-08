import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RekapCampaign } from "./page";

const replaceMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/rekap",
  useSearchParams: () => mockSearchParams,
}));

const { RekapClient } = await import("./rekap-client");

afterEach(() => {
  cleanup();
  replaceMock.mockClear();
  mockSearchParams = new URLSearchParams();
});

function makeCampaign(overrides: Partial<RekapCampaign> = {}): RekapCampaign {
  return {
    id: "c-1",
    name: "Promo Lebaran",
    skp_number: "SKP-001",
    status: "approved",
    requested_budget: 1_000_000,
    actual_spent: 500_000,
    sales_projection: 0,
    objective: null,
    mechanism: "Diskon",
    store_id: "ST-100",
    start_date: null,
    end_date: null,
    submitted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    department: null,
    brand: null,
    region: null,
    channel: null,
    promotion_category: null,
    action_approval: null,
    vendor: null,
    distributor: null,
    realizations: [],
    ...overrides,
  } as RekapCampaign;
}

const campaigns: RekapCampaign[] = [
  makeCampaign({ id: "c-1", skp_number: "SKP-001", name: "Promo Lebaran", store_id: "ST-100" }),
  makeCampaign({ id: "c-2", skp_number: "SKP-002", name: "Promo Natal", store_id: "ST-200" }),
];

const baseFilters = {
  status: [],
  brand: "",
  region: "",
  department: "",
  action_approval: "",
  date_from: "",
  date_to: "",
  q: "",
};

const baseProps = {
  departments: [],
  brands: [],
  regions: [],
  actionApprovals: [],
  userRole: "admin" as const,
};

describe("RekapClient search", () => {
  it("shows all campaigns with no search active", () => {
    render(<RekapClient campaigns={campaigns} {...baseProps} filters={baseFilters} />);
    expect(screen.getByText("2 SKP ditemukan")).toBeTruthy();
    expect(screen.getByText("Promo Lebaran")).toBeTruthy();
    expect(screen.getByText("Promo Natal")).toBeTruthy();
  });

  it("filters campaigns by name via the filters.q prop", () => {
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "lebaran" }} />
    );
    expect(screen.getByText("1 SKP ditemukan")).toBeTruthy();
    expect(screen.getByText("Promo Lebaran")).toBeTruthy();
    expect(screen.queryByText("Promo Natal")).toBeNull();
  });

  it("filters campaigns by skp_number", () => {
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "skp-002" }} />
    );
    expect(screen.getByText("Promo Natal")).toBeTruthy();
    expect(screen.queryByText("Promo Lebaran")).toBeNull();
  });

  it("filters campaigns by store_id", () => {
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "st-200" }} />
    );
    expect(screen.getByText("Promo Natal")).toBeTruthy();
    expect(screen.queryByText("Promo Lebaran")).toBeNull();
  });

  it("shows the no-results message when search matches nothing", () => {
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "zzz" }} />
    );
    expect(screen.getByText('Tidak ada hasil untuk “zzz”')).toBeTruthy();
    expect(screen.queryByText("Tidak ada data SKP yang sesuai filter.")).toBeNull();
  });

  it("shows the generic empty message when there is no search and no data", () => {
    render(<RekapClient campaigns={[]} {...baseProps} filters={baseFilters} />);
    expect(screen.getByText("Tidak ada data SKP yang sesuai filter.")).toBeTruthy();
  });

  it("typing in the search box updates the q query param via router.replace", () => {
    render(<RekapClient campaigns={campaigns} {...baseProps} filters={baseFilters} />);
    const input = screen.getByPlaceholderText("Cari No. SKP, nama SKP, atau ID Store...");
    fireEvent.change(input, { target: { value: "lebaran" } });
    expect(replaceMock).toHaveBeenCalledWith("/rekap?q=lebaran", { scroll: false });
  });

  it("clearing the search box removes q from the URL", () => {
    mockSearchParams = new URLSearchParams("q=lebaran");
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "lebaran" }} />
    );
    fireEvent.click(screen.getByLabelText("Hapus pencarian"));
    expect(replaceMock).toHaveBeenCalledWith("/rekap?", { scroll: false });
  });

  it("shows the Reset button when q is active in the URL and clears the whole URL on click", () => {
    mockSearchParams = new URLSearchParams("q=lebaran");
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={{ ...baseFilters, q: "lebaran" }} />
    );
    fireEvent.click(screen.getByText("Reset"));
    expect(replaceMock).toHaveBeenCalledWith("/rekap", { scroll: false });
  });

  it("does not show the Reset button when no filter or search is active", () => {
    render(<RekapClient campaigns={campaigns} {...baseProps} filters={baseFilters} />);
    expect(screen.queryByText("Reset")).toBeNull();
  });

  it("renders the same search box for the distributor view", () => {
    render(
      <RekapClient campaigns={campaigns} {...baseProps} filters={baseFilters} isDistributor />
    );
    expect(screen.getByPlaceholderText("Cari No. SKP, nama SKP, atau ID Store...")).toBeTruthy();
  });
});

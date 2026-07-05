import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendSkpSubmittedEmail: vi.fn() }));

import { submitCampaignAction } from "./campaigns";
import { createClient } from "@/lib/supabase/server";

// -------------------------------------------------------
// Mock builder helpers
// -------------------------------------------------------

function makeQueryChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data }),
  };
}

function makeFileCountChain(count: number) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ count, error: null }),
  };
}

function setupMocks() {
  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users")
        return makeQueryChain({ role: "user", is_active: true, department_id: null, region_id: null });
      if (table === "campaign_files") return makeFileCountChain(0);
      return {};
    }),
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

  return { mockClient };
}

const uuid = "11111111-1111-4111-8111-111111111111";

function baseSubmitData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: uuid,
    name: "Test SKP",
    department_id: uuid,
    brand_id: uuid,
    region_id: uuid,
    channel_id: uuid,
    promotion_category_id: uuid,
    mechanism: "Test mechanism",
    avg_sales_3months: 0,
    requested_budget: 0,
    sales_projection: 0,
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    ...overrides,
  };
}

describe("submitCampaignAction — optional numeric fields", () => {
  it("accepts avg_sales_3months and requested_budget left at 0 (schema validation passes)", async () => {
    setupMocks();

    const result = await submitCampaignAction(baseSubmitData());

    // If schema validation rejected the 0 values, we'd get a validation message here
    // instead of the (later) file-count check message.
    expect(result.error).toBe("Minimal 1 dokumen SKP harus diupload sebelum mengajukan");
  });
});

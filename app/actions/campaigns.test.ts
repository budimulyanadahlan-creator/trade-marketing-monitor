import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendSkpSubmittedEmail: vi.fn() }));

import { saveDraftCampaignAction, submitCampaignAction } from "./campaigns";
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
    requested_budget: 50000,
    sales_projection: 0,
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    ...overrides,
  };
}

describe("submitCampaignAction — optional numeric fields", () => {
  it("accepts avg_sales_3months and sales_projection left at 0 (schema validation passes)", async () => {
    setupMocks();

    const result = await submitCampaignAction(baseSubmitData());

    // If schema validation rejected the 0 values, we'd get a validation message here
    // instead of the (later) file-count check message.
    expect(result.error).toBe("Minimal 1 dokumen SKP harus diupload sebelum mengajukan");
  });
});

describe("submitCampaignAction — minimum requested_budget", () => {
  it("rejects requested_budget of 0 with a validation message", async () => {
    setupMocks();

    const result = await submitCampaignAction(baseSubmitData({ requested_budget: 0 }));

    expect(result.error).toBe("Budget harus lebih dari Rp10.000");
  });

  it("rejects placeholder requested_budget values below the threshold (e.g. 1000)", async () => {
    setupMocks();

    const result = await submitCampaignAction(baseSubmitData({ requested_budget: 1000 }));

    expect(result.error).toBe("Budget harus lebih dari Rp10.000");
  });

  it("accepts requested_budget above the threshold and proceeds past schema validation", async () => {
    setupMocks();

    const result = await submitCampaignAction(baseSubmitData({ requested_budget: 10001 }));

    expect(result.error).toBe("Minimal 1 dokumen SKP harus diupload sebelum mengajukan");
  });
});

// -------------------------------------------------------
// distributor_id
// -------------------------------------------------------

function makeInsertChain(captured: { payload?: unknown }) {
  return {
    insert: vi.fn().mockImplementation((p: unknown) => {
      captured.payload = p;
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: uuid }, error: null }),
      };
    }),
  };
}

function makeUpdateChain(captured: { payload?: unknown }) {
  const chain = {
    update: vi.fn().mockImplementation((p: unknown) => {
      captured.payload = p;
      return chain;
    }),
    eq: vi.fn().mockImplementation(() => chain),
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  return chain;
}

describe("distributor_id disimpan mengikuti pola vendor_id", () => {
  it("saveDraftCampaignAction menyertakan distributor_id di payload insert", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users")
          return makeQueryChain({ role: "user", is_active: true, department_id: null, region_id: null });
        if (table === "campaigns") return makeInsertChain(captured);
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const result = await saveDraftCampaignAction({
      name: "Draft SKP",
      department_id: uuid,
      brand_id: uuid,
      region_id: uuid,
      distributor_id: uuid,
    });

    expect(result.error).toBeUndefined();
    expect(captured.payload).toMatchObject({ distributor_id: uuid });
  });

  it("submitCampaignAction menyertakan distributor_id di payload update", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users")
          return makeQueryChain({ role: "user", is_active: true, department_id: null, region_id: null });
        if (table === "campaign_files") return makeFileCountChain(1);
        if (table === "campaigns") return makeUpdateChain(captured);
        if (table === "approval_history")
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const result = await submitCampaignAction(
      baseSubmitData({ distributor_id: uuid }) as Parameters<typeof submitCampaignAction>[0]
    );

    expect(result.error).toBeUndefined();
    expect(captured.payload).toMatchObject({ distributor_id: uuid });
  });

  it("distributor_id boleh kosong: tersimpan sebagai null", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users")
          return makeQueryChain({ role: "user", is_active: true, department_id: null, region_id: null });
        if (table === "campaigns") return makeInsertChain(captured);
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const result = await saveDraftCampaignAction({
      name: "Draft tanpa distributor",
      department_id: uuid,
      brand_id: uuid,
      region_id: uuid,
    });

    expect(result.error).toBeUndefined();
    expect(captured.payload).toMatchObject({ distributor_id: null });
  });
});

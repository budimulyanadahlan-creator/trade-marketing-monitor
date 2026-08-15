import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { upsertClaimChecklistAction } from "./claim-checklist";
import { createClient } from "@/lib/supabase/server";

function makeQueryChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data }),
  };
}

function setupMocks({
  role = "distributor",
  isActive = true,
  campaign = { id: "camp-1", status: "ongoing" },
  upsertError = null,
}: Partial<{
  role: string;
  isActive: boolean;
  campaign: { id: string; status: string } | null;
  upsertError: { message: string } | null;
}> = {}) {
  const upsertChain = { upsert: vi.fn().mockResolvedValue({ error: upsertError }) };

  const mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "dist-1" } } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "users") return makeQueryChain({ role, is_active: isActive });
      if (table === "campaigns") return makeQueryChain(campaign);
      if (table === "distributor_claim_checklists") return upsertChain;
      return {};
    }),
  };

  vi.mocked(createClient).mockResolvedValue(mockClient as never);
  return { upsertChain };
}

describe("upsertClaimChecklistAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows toggling while status is ongoing", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "ongoing" } });
    const result = await upsertClaimChecklistAction("camp-1", "doc-1", true);
    expect(result).toEqual({ success: true });
  });

  it("allows toggling while status is approved", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "approved" } });
    const result = await upsertClaimChecklistAction("camp-1", "doc-1", true);
    expect(result).toEqual({ success: true });
  });

  it("rejects toggling once the claim has been submitted (locked)", async () => {
    setupMocks({ campaign: { id: "camp-1", status: "claim_submitted" } });
    const result = await upsertClaimChecklistAction("camp-1", "doc-1", true);
    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/Approved|Ongoing/i);
  });

  it("rejects non-distributor roles", async () => {
    setupMocks({ role: "admin" });
    const result = await upsertClaimChecklistAction("camp-1", "doc-1", true);
    expect(result.error).toMatch(/distributor/i);
  });
});

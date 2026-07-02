import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/email", () => ({
  sendSkpPendingDigestEmail: vi.fn(),
}));

import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSkpPendingDigestEmail } from "@/lib/email";

function makeRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/skp-reminder", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function makeCampaignsChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data }),
  };
}

function makeUsersChain(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data }),
  };
}

function makeAdminClient({
  campaigns = [],
  adminUsers = [],
  authUsers = [],
}: {
  campaigns?: unknown[];
  adminUsers?: unknown[];
  authUsers?: unknown[];
}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "campaigns") return makeCampaignsChain(campaigns);
      if (table === "users") return makeUsersChain(adminUsers);
      return {};
    }),
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: authUsers } }),
      },
    },
  };
}

describe("GET /api/cron/skp-reminder", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: "test-secret" };
  });

  it("returns 401 when authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header has the wrong secret", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns sent:false and does not email when there are no pending campaigns", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdminClient({ campaigns: [] }) as never);

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: false, pendingCount: 0 });
    expect(sendSkpPendingDigestEmail).not.toHaveBeenCalled();
  });

  it("emails active admin/superadmin recipients when campaigns are pending", async () => {
    const adminClient = makeAdminClient({
      campaigns: [
        {
          id: "camp-1",
          name: "Promo Lebaran",
          submitted_at: "2026-07-01T01:00:00.000Z",
          department: { name: "Sales" },
        },
      ],
      adminUsers: [
        { id: "user-1", full_name: "Admin One" },
        { id: "user-2", full_name: "Admin Two" },
      ],
      authUsers: [
        { id: "user-1", email: "admin1@example.com" },
        { id: "user-2", email: "admin2@example.com" },
        { id: "user-3", email: "not-admin@example.com" },
      ],
    });
    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: true, pendingCount: 1, recipientCount: 2 });

    expect(sendSkpPendingDigestEmail).toHaveBeenCalledWith({
      to: [
        { email: "admin1@example.com", name: "Admin One" },
        { email: "admin2@example.com", name: "Admin Two" },
      ],
      pendingItems: [
        {
          campaignId: "camp-1",
          campaignName: "Promo Lebaran",
          departmentName: "Sales",
          submittedAt: "2026-07-01T01:00:00.000Z",
        },
      ],
    });
  });

  it("does not email when there are pending campaigns but no active admin recipients", async () => {
    const adminClient = makeAdminClient({
      campaigns: [
        {
          id: "camp-1",
          name: "Promo Lebaran",
          submitted_at: "2026-07-01T01:00:00.000Z",
          department: { name: "Sales" },
        },
      ],
      adminUsers: [],
      authUsers: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(adminClient as never);

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: false, pendingCount: 1, recipientCount: 0 });
    expect(sendSkpPendingDigestEmail).not.toHaveBeenCalled();
  });
});

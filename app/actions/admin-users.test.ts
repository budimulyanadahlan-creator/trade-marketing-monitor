import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendPasswordResetNotificationEmail: vi.fn() }));

import { createUserAction, updateUserAction } from "./admin-users";
import { createClient, createAdminClient } from "@/lib/supabase/server";

function makeUserChain(profile: { role: string; is_active?: boolean }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile }),
  };
}

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const uuid = "11111111-1111-4111-8111-111111111111";
const distributorUuid = "22222222-2222-4222-8222-222222222222";

// -------------------------------------------------------
// createUserAction — distributor_id
// -------------------------------------------------------

describe("createUserAction — distributor_id", () => {
  function setup(actorRole: string) {
    const insert = vi.fn().mockResolvedValue({ error: null });

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") return makeUserChain({ role: actorRole, is_active: true });
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const adminClient = {
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: uuid } },
            error: null,
          }),
          deleteUser: vi.fn(),
        },
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") return { insert };
        return {};
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);

    return { insert };
  }

  it("saves distributor_id when role is distributor", async () => {
    const { insert } = setup("admin");

    const result = await createUserAction(
      {},
      formDataOf({
        email: "dist@example.com",
        password: "password123",
        full_name: "Distributor User",
        role: "distributor",
        region_id: uuid,
        distributor_id: distributorUuid,
      })
    );

    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ distributor_id: distributorUuid })
    );
  });

  it("forces distributor_id to null when role is not distributor", async () => {
    const { insert } = setup("admin");

    const result = await createUserAction(
      {},
      formDataOf({
        email: "user@example.com",
        password: "password123",
        full_name: "Regular User",
        role: "user",
        distributor_id: distributorUuid,
      })
    );

    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ distributor_id: null }));
  });

  it("stores empty distributor_id as null for distributor role", async () => {
    const { insert } = setup("admin");

    const result = await createUserAction(
      {},
      formDataOf({
        email: "dist2@example.com",
        password: "password123",
        full_name: "Distributor Two",
        role: "distributor",
        region_id: uuid,
      })
    );

    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ distributor_id: null }));
  });
});

// -------------------------------------------------------
// updateUserAction — distributor_id
// -------------------------------------------------------

describe("updateUserAction — distributor_id", () => {
  function setup({
    actorRole,
    targetRole,
  }: {
    actorRole: string;
    targetRole: string;
  }) {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

    let callCount = 0;
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") {
          callCount += 1;
          // First "users" lookup is the actor profile check, second is the target user role check.
          const profile = callCount === 1 ? { role: actorRole, is_active: true } : { role: targetRole };
          return { ...makeUserChain(profile), update };
        }
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    return { update };
  }

  it("saves distributor_id when role stays distributor", async () => {
    const { update } = setup({ actorRole: "admin", targetRole: "distributor" });

    const result = await updateUserAction(
      {},
      formDataOf({
        id: uuid,
        full_name: "Distributor User",
        role: "distributor",
        region_id: uuid,
        distributor_id: distributorUuid,
      })
    );

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ distributor_id: distributorUuid })
    );
  });

  it("clears distributor_id when role changes away from distributor", async () => {
    const { update } = setup({ actorRole: "admin", targetRole: "distributor" });

    const result = await updateUserAction(
      {},
      formDataOf({
        id: uuid,
        full_name: "Now A Regular User",
        role: "user",
        distributor_id: distributorUuid,
      })
    );

    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ distributor_id: null }));
  });
});

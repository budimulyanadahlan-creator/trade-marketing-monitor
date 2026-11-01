import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendPasswordResetNotificationEmail: vi.fn() }));

import {
  createUserAction,
  updateUserAction,
  toggleUserActiveAction,
  resetUserPasswordAction,
} from "./admin-users";
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
        distributor_scope: "cabang",
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

  it("flags new users to change their password at first login", async () => {
    const { insert } = setup("admin");

    const result = await createUserAction(
      {},
      formDataOf({
        email: "user@example.com",
        password: "password123",
        full_name: "Regular User",
        role: "user",
      })
    );

    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ must_change_password: true })
    );
  });
});

// -------------------------------------------------------
// resetUserPasswordAction — must_change_password
// -------------------------------------------------------

describe("resetUserPasswordAction — must_change_password", () => {
  it("turns the flag on after resetting the password", async () => {
    // Satu mock `single` dipakai bersama: panggilan pertama = profil aktor,
    // kedua = user target.
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: { role: "admin", is_active: true } })
      .mockResolvedValueOnce({ data: { role: "user", full_name: "Target" } });
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }),
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") {
          return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single };
        }
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const flagEq = vi.fn().mockResolvedValue({ error: null });
    const flagUpdate = vi.fn().mockReturnValue({ eq: flagEq });
    const adminClient = {
      auth: {
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ error: null }),
          getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "t@x.com" } } }),
        },
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") return { update: flagUpdate };
        return {};
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);

    const result = await resetUserPasswordAction(
      {},
      formDataOf({ id: uuid, password: "password123", confirmPassword: "password123" })
    );

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(adminClient.auth.admin.updateUserById).toHaveBeenCalledWith(uuid, {
      password: "password123",
    });
    expect(flagUpdate).toHaveBeenCalledWith({ must_change_password: true });
    expect(flagEq).toHaveBeenCalledWith("id", uuid);
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
        distributor_scope: "cabang",
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

// -------------------------------------------------------
// createUserAction — distributor_scope (Fase 2 multi-user distributor)
// -------------------------------------------------------

describe("createUserAction — distributor_scope", () => {
  function setup() {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") return makeUserChain({ role: "admin", is_active: true });
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    const adminClient = {
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({ data: { user: { id: uuid } }, error: null }),
          deleteUser: vi.fn(),
        },
      },
      from: vi.fn().mockImplementation((table: string) => (table === "users" ? { insert } : {})),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(adminClient);
    return { insert, createUser: adminClient.auth.admin.createUser };
  }

  const base = {
    email: "dist@example.com",
    password: "password123",
    full_name: "Distributor User",
    role: "distributor",
  };

  it("rejects a distributor without a company", async () => {
    const { createUser } = setup();
    const result = await createUserAction(
      {},
      formDataOf({ ...base, region_id: uuid, distributor_scope: "cabang" })
    );
    expect(result.error).toBe("Perusahaan wajib diisi untuk Distributor.");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a distributor without a scope", async () => {
    const { createUser } = setup();
    const result = await createUserAction(
      {},
      formDataOf({ ...base, region_id: uuid, distributor_id: distributorUuid })
    );
    expect(result.error).toBe("Cakupan (Cabang/Pusat) wajib diisi untuk Distributor.");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects scope cabang without a region", async () => {
    const { createUser } = setup();
    const result = await createUserAction(
      {},
      formDataOf({ ...base, distributor_id: distributorUuid, distributor_scope: "cabang" })
    );
    expect(result.error).toBe("Region wajib diisi untuk Distributor Cabang.");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("saves scope pusat even without a region", async () => {
    const { insert } = setup();
    const result = await createUserAction(
      {},
      formDataOf({ ...base, distributor_id: distributorUuid, distributor_scope: "pusat" })
    );
    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        distributor_id: distributorUuid,
        distributor_scope: "pusat",
        region_id: null,
      })
    );
  });

  it("saves scope cabang with company and region", async () => {
    const { insert } = setup();
    const result = await createUserAction(
      {},
      formDataOf({
        ...base,
        distributor_id: distributorUuid,
        distributor_scope: "cabang",
        region_id: uuid,
      })
    );
    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ distributor_scope: "cabang", region_id: uuid })
    );
  });

  it("forces distributor_scope to null for non-distributor roles", async () => {
    const { insert } = setup();
    const result = await createUserAction(
      {},
      formDataOf({ ...base, role: "user", distributor_scope: "pusat" })
    );
    expect(result.error).toBeUndefined();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ distributor_scope: null }));
  });
});

// -------------------------------------------------------
// updateUserAction — distributor_scope (Fase 2 multi-user distributor)
// -------------------------------------------------------

describe("updateUserAction — distributor_scope", () => {
  function setup() {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    let callCount = 0;
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") {
          callCount += 1;
          const profile =
            callCount === 1 ? { role: "admin", is_active: true } : { role: "distributor" };
          return { ...makeUserChain(profile), update };
        }
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    return { update };
  }

  const base = { id: uuid, full_name: "Distributor User", role: "distributor" };

  it("rejects a distributor without a company", async () => {
    const { update } = setup();
    const result = await updateUserAction(
      {},
      formDataOf({ ...base, region_id: uuid, distributor_scope: "cabang" })
    );
    expect(result.error).toBe("Perusahaan wajib diisi untuk Distributor.");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a distributor without a scope", async () => {
    const { update } = setup();
    const result = await updateUserAction(
      {},
      formDataOf({ ...base, region_id: uuid, distributor_id: distributorUuid })
    );
    expect(result.error).toBe("Cakupan (Cabang/Pusat) wajib diisi untuk Distributor.");
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects scope cabang without a region", async () => {
    const { update } = setup();
    const result = await updateUserAction(
      {},
      formDataOf({ ...base, distributor_id: distributorUuid, distributor_scope: "cabang" })
    );
    expect(result.error).toBe("Region wajib diisi untuk Distributor Cabang.");
    expect(update).not.toHaveBeenCalled();
  });

  it("saves scope pusat without a region", async () => {
    const { update } = setup();
    const result = await updateUserAction(
      {},
      formDataOf({ ...base, distributor_id: distributorUuid, distributor_scope: "pusat" })
    );
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ distributor_scope: "pusat", region_id: null })
    );
  });

  it("clears distributor_scope when role changes away from distributor", async () => {
    const { update } = setup();
    const result = await updateUserAction(
      {},
      formDataOf({ ...base, role: "user", distributor_scope: "pusat" })
    );
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ distributor_id: null, distributor_scope: null })
    );
  });
});

// -------------------------------------------------------
// toggleUserActiveAction — akun distributor tanpa perusahaan
// -------------------------------------------------------

describe("toggleUserActiveAction — distributor tanpa perusahaan", () => {
  function setup(target: { role: string; distributor_id: string | null }) {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    let callCount = 0;
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "actor-1" } } }) },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "users") {
          callCount += 1;
          const profile = callCount === 1 ? { role: "admin", is_active: true } : target;
          return { ...makeUserChain(profile), update };
        }
        return {};
      }),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
    return { update };
  }

  it("rejects activating a distributor account without a company", async () => {
    const { update } = setup({ role: "distributor", distributor_id: null });
    const result = await toggleUserActiveAction(uuid, true);
    expect(result.error).toMatch(/belum terhubung ke perusahaan/);
    expect(update).not.toHaveBeenCalled();
  });

  it("still allows deactivating a distributor account without a company", async () => {
    const { update } = setup({ role: "distributor", distributor_id: null });
    const result = await toggleUserActiveAction(uuid, false);
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: false });
  });

  it("allows activating a distributor account with a company", async () => {
    const { update } = setup({ role: "distributor", distributor_id: distributorUuid });
    const result = await toggleUserActiveAction(uuid, true);
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: true });
  });

  it("does not affect non-distributor accounts", async () => {
    const { update } = setup({ role: "user", distributor_id: null });
    const result = await toggleUserActiveAction(uuid, true);
    expect(result.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ is_active: true });
  });
});

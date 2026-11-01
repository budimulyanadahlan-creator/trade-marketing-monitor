import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  createAnonClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import { changePasswordAction } from "./auth";
import { createClient, createAdminClient, createAnonClient } from "@/lib/supabase/server";
import { PASSWORD_CHANGE_MESSAGES } from "@/lib/password-change";

function formDataOf(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const validForm = {
  currentPassword: "lama12345",
  newPassword: "baru12345",
  confirmPassword: "baru12345",
};

function setup(opts: {
  user?: { id: string; email: string } | null;
  role?: string;
  signInError?: boolean;
  updateUserError?: boolean;
}) {
  const user = opts.user === undefined ? { id: "u-1", email: "u@x.com" } : opts.user;
  const updateUser = vi.fn().mockResolvedValue({
    error: opts.updateUserError ? { message: "boom" } : null,
  });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      updateUser,
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: opts.role ?? "user" } }),
    }),
  };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

  const signInWithPassword = vi.fn().mockResolvedValue({
    data: {},
    error: opts.signInError ? { message: "Invalid login credentials" } : null,
  });
  (createAnonClient as ReturnType<typeof vi.fn>).mockReturnValue({
    auth: { signInWithPassword },
  });

  const adminEq = vi.fn().mockResolvedValue({ error: null });
  const adminUpdate = vi.fn().mockReturnValue({ eq: adminEq });
  (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ update: adminUpdate }),
  });

  return { updateUser, signInWithPassword, adminUpdate, adminEq };
}

beforeEach(() => vi.clearAllMocks());

describe("changePasswordAction", () => {
  it("rejects when not logged in", async () => {
    setup({ user: null });
    const result = await changePasswordAction({}, formDataOf(validForm));
    expect(result.error).toBeTruthy();
  });

  it("returns validation message without touching auth", async () => {
    const { signInWithPassword, updateUser } = setup({});
    const result = await changePasswordAction(
      {},
      formDataOf({ ...validForm, newPassword: "baru123", confirmPassword: "baru123" })
    );
    expect(result.error).toBe(PASSWORD_CHANGE_MESSAGES.tooShort);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects wrong current password", async () => {
    const { signInWithPassword, updateUser } = setup({ signInError: true });
    const result = await changePasswordAction({}, formDataOf(validForm));
    expect(result.error).toBe(PASSWORD_CHANGE_MESSAGES.currentWrong);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "u@x.com",
      password: "lama12345",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("surfaces auth update failure", async () => {
    const { adminUpdate } = setup({ updateUserError: true });
    const result = await changePasswordAction({}, formDataOf(validForm));
    expect(result.error).toBeTruthy();
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("updates password, clears flag, and redirects distributor to /campaigns", async () => {
    const { updateUser, adminUpdate, adminEq } = setup({ role: "distributor" });
    await expect(changePasswordAction({}, formDataOf(validForm))).rejects.toThrow(
      "REDIRECT:/campaigns"
    );
    expect(updateUser).toHaveBeenCalledWith({ password: "baru12345" });
    expect(adminUpdate).toHaveBeenCalledWith({ must_change_password: false });
    expect(adminEq).toHaveBeenCalledWith("id", "u-1");
  });

  it("redirects non-distributor to /dashboard", async () => {
    setup({ role: "finance" });
    await expect(changePasswordAction({}, formDataOf(validForm))).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });
});

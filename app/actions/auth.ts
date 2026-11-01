"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, createAdminClient, createAnonClient } from "@/lib/supabase/server";
import {
  passwordChangeError,
  postPasswordChangeRedirect,
  PASSWORD_CHANGE_MESSAGES,
} from "@/lib/password-change";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password harus diisi"),
});

export type LoginState = {
  error?: string;
};

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Input tidak valid";
    return { error: firstError };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Email atau password salah. Silakan coba lagi." };
  }

  // Check if account is active in our users table
  const { data: profile } = await supabase
    .from("users")
    .select("is_active, role, must_change_password")
    .eq("id", data.user.id)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return {
      error: "Akun Anda telah dinonaktifkan. Hubungi administrator.",
    };
  }

  revalidatePath("/", "layout");
  if (profile.must_change_password) redirect("/ganti-password");
  redirect(postPasswordChangeRedirect(profile.role));
}

export type ChangePasswordState = {
  error?: string;
};

/**
 * Ganti password mandiri (Fase 4 multi-user distributor). Memverifikasi
 * password lama lewat sign-in terpisah tanpa sesi, mengganti password di
 * Supabase Auth, mematikan `must_change_password`, lalu mengarahkan ke
 * halaman awal sesuai role.
 */
export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return { error: "Sesi Anda sudah berakhir. Silakan login kembali." };
  }

  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");
  const input = {
    currentPassword: typeof currentPassword === "string" ? currentPassword : "",
    newPassword: typeof newPassword === "string" ? newPassword : "",
    confirmPassword: typeof confirmPassword === "string" ? confirmPassword : "",
  };

  const validationError = passwordChangeError(input);
  if (validationError) return { error: validationError };

  // Verifikasi password lama tanpa mengganggu sesi/cookie user saat ini.
  const anon = createAnonClient();
  const { error: verifyError } = await anon.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verifyError) return { error: PASSWORD_CHANGE_MESSAGES.currentWrong };

  const { error: updateError } = await supabase.auth.updateUser({
    password: input.newPassword,
  });
  if (updateError) {
    return { error: "Gagal mengganti password: " + updateError.message };
  }

  // Service role: policy users_update_self dijaga trigger agar user biasa
  // tidak bisa mematikan flag-nya sendiri tanpa ganti password.
  const adminClient = createAdminClient();
  const { error: flagError } = await adminClient
    .from("users")
    .update({ must_change_password: false })
    .eq("id", user.id);
  if (flagError) {
    return {
      error:
        "Password sudah diganti, tetapi status akun gagal diperbarui. Muat ulang halaman atau hubungi admin.",
    };
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  revalidatePath("/", "layout");
  redirect(postPasswordChangeRedirect(profile?.role));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

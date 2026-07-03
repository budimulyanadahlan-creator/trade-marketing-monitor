"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { UserRole } from "@/types/database";

const roleRank: Record<UserRole, number> = {
  distributor: 0,
  user: 0,
  manager: 1,
  finance: 2,
  admin: 3,
  superadmin: 4,
};

const createUserSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  full_name: z.string().min(2, "Nama lengkap minimal 2 karakter"),
  department_id: z
    .string()
    .uuid("Department tidak valid")
    .optional()
    .or(z.literal("")),
  region_id: z
    .string()
    .uuid("Region tidak valid")
    .optional()
    .or(z.literal("")),
  role: z.enum(["user", "manager", "finance", "admin", "superadmin", "distributor"]),
});

export type CreateUserState = {
  error?: string;
  success?: boolean;
};

async function getCurrentAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    !["admin", "superadmin"].includes(profile.role)
  ) {
    throw new Error("Forbidden");
  }

  return { userId: user.id, role: profile.role as UserRole };
}

export async function createUserAction(
  _prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  let actorRole: UserRole;
  try {
    const actor = await getCurrentAdminProfile();
    actorRole = actor.role;
  } catch {
    return { error: "Anda tidak memiliki akses untuk membuat user baru." };
  }

  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
    full_name: formData.get("full_name"),
    department_id: formData.get("department_id") || undefined,
    region_id: formData.get("region_id") || undefined,
    role: formData.get("role"),
  };

  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "Input tidak valid";
    return { error: firstError };
  }

  // Role hierarchy: actor can only assign roles strictly below their own
  if (roleRank[parsed.data.role as UserRole] >= roleRank[actorRole]) {
    return {
      error: `Anda tidak bisa membuat user dengan role ${parsed.data.role}.`,
    };
  }

  // Region required for distributor role and Sales department
  if (parsed.data.role === "distributor" && !parsed.data.region_id) {
    return { error: "Region wajib diisi untuk Distributor." };
  }
  if (parsed.data.department_id) {
    const supabase = await createClient();
    const { data: dept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", parsed.data.department_id)
      .single();
    if (dept?.name?.toLowerCase() === "sales" && !parsed.data.region_id) {
      return { error: "Region wajib diisi untuk user di Sales Department." };
    }
  }

  const adminClient = createAdminClient();

  const { data: authUser, error: authError } =
    await adminClient.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
    });

  if (authError) {
    if (authError.message.includes("already registered")) {
      return { error: "Email sudah terdaftar." };
    }
    return { error: authError.message };
  }

  if (!authUser.user) {
    return { error: "Gagal membuat akun. Silakan coba lagi." };
  }

  const { error: profileError } = await adminClient.from("users").insert({
    id: authUser.user.id,
    full_name: parsed.data.full_name,
    department_id: parsed.data.department_id || null,
    region_id: parsed.data.region_id || null,
    role: parsed.data.role as UserRole,
    is_active: true,
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return { error: "Gagal menyimpan profil user." };
  }

  revalidatePath("/admin/users");
  return { success: true };
}

const updateUserSchema = z.object({
  id: z.string().uuid("User ID tidak valid"),
  full_name: z.string().min(2, "Nama lengkap minimal 2 karakter"),
  role: z.enum(["user", "manager", "finance", "admin", "superadmin", "distributor"]),
  department_id: z.string().uuid().optional().or(z.literal("")),
  region_id: z.string().uuid().optional().or(z.literal("")),
});

export type UpdateUserState = { error?: string; success?: boolean };

export async function updateUserAction(
  _prevState: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  let actorRole: UserRole;
  try {
    const actor = await getCurrentAdminProfile();
    actorRole = actor.role;
  } catch {
    return { error: "Anda tidak memiliki akses." };
  }

  const raw = {
    id: formData.get("id"),
    full_name: formData.get("full_name"),
    role: formData.get("role"),
    department_id: formData.get("department_id") || undefined,
    region_id: formData.get("region_id") || undefined,
  };

  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  if (roleRank[parsed.data.role as UserRole] >= roleRank[actorRole]) {
    return { error: `Anda tidak bisa mengubah ke role ${parsed.data.role}.` };
  }

  // Region required for distributor role and Sales department
  if (parsed.data.role === "distributor" && !parsed.data.region_id) {
    return { error: "Region wajib diisi untuk Distributor." };
  }

  const supabase = await createClient();

  if (parsed.data.department_id) {
    const { data: dept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", parsed.data.department_id)
      .single();
    if (dept?.name?.toLowerCase() === "sales" && !parsed.data.region_id) {
      return { error: "Region wajib diisi untuk user di Sales Department." };
    }
  }

  const { data: target } = await supabase
    .from("users")
    .select("role")
    .eq("id", parsed.data.id)
    .single();

  if (!target) return { error: "User tidak ditemukan." };
  if (roleRank[target.role as UserRole] >= roleRank[actorRole]) {
    return { error: "Anda tidak bisa mengedit user dengan role lebih tinggi." };
  }

  const { error } = await supabase
    .from("users")
    .update({
      full_name: parsed.data.full_name,
      role: parsed.data.role as UserRole,
      department_id: parsed.data.department_id || null,
      region_id: parsed.data.region_id || null,
    })
    .eq("id", parsed.data.id);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function deleteUserAction(
  userId: string
): Promise<{ error?: string }> {
  let actorRole: UserRole;
  let actorId: string;
  try {
    const actor = await getCurrentAdminProfile();
    actorRole = actor.role;
    actorId = actor.userId;
  } catch {
    return { error: "Unauthorized" };
  }

  if (userId === actorId) return { error: "Tidak bisa menghapus akun sendiri." };

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (!target) return { error: "User tidak ditemukan." };
  if (roleRank[target.role as UserRole] >= roleRank[actorRole]) {
    return { error: "Anda tidak bisa menghapus user dengan role lebih tinggi." };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return {};
}

const resetPasswordSchema = z
  .object({
    id: z.string().uuid("User ID tidak valid"),
    password: z.string().min(8, "Password minimal 8 karakter"),
    confirmPassword: z.string().min(8, "Konfirmasi password minimal 8 karakter"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Password dan konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export type ResetPasswordState = { error?: string; success?: boolean };

export async function resetUserPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  let actorRole: UserRole;
  let actorId: string;
  try {
    const actor = await getCurrentAdminProfile();
    actorRole = actor.role;
    actorId = actor.userId;
  } catch {
    return { error: "Unauthorized" };
  }

  const raw = {
    id: formData.get("id"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  if (parsed.data.id === actorId) {
    return { error: "Tidak bisa mereset password akun sendiri." };
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("users")
    .select("role")
    .eq("id", parsed.data.id)
    .single();

  if (!target) return { error: "User tidak ditemukan." };
  if (roleRank[target.role as UserRole] >= roleRank[actorRole]) {
    return {
      error: `Anda tidak bisa mereset password user dengan role ${target.role}.`,
    };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.updateUserById(parsed.data.id, {
    password: parsed.data.password,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}

export async function toggleUserActiveAction(
  userId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  let actorRole: UserRole;
  let actorId: string;
  try {
    const actor = await getCurrentAdminProfile();
    actorRole = actor.role;
    actorId = actor.userId;
  } catch {
    return { error: "Unauthorized" };
  }

  // Cannot deactivate yourself
  if (userId === actorId) {
    return { error: "Tidak bisa menonaktifkan akun sendiri." };
  }

  const supabase = await createClient();

  // Fetch target user's role
  const { data: targetProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (!targetProfile) {
    return { error: "User tidak ditemukan." };
  }

  // Role hierarchy: actor can only manage users with strictly lower role rank
  if (roleRank[targetProfile.role as UserRole] >= roleRank[actorRole]) {
    return {
      error: `Anda tidak memiliki izin untuk menonaktifkan user dengan role ${targetProfile.role}.`,
    };
  }

  const { error } = await supabase
    .from("users")
    .update({ is_active: isActive })
    .eq("id", userId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return {};
}

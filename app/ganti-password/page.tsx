import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/app/actions/auth";
import { postPasswordChangeRedirect } from "@/lib/password-change";
import { ChangePasswordForm } from "./change-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, KeyRound, LogOut, ShieldAlert } from "lucide-react";

export const metadata = { title: "Ganti Password — Marmot" };

/**
 * Halaman ganti password untuk semua role. Berada di luar grup (protected)
 * agar tetap bisa dibuka saat `must_change_password` menyala — layout
 * (protected) mengalihkan semua halaman lain ke sini selama flag menyala.
 */
export default async function GantiPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, is_active, must_change_password")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login");
  }

  const mustChange = profile.must_change_password;
  const backHref = postPasswordChangeRedirect(profile.role);
  const emailSuffix = user.email ? ` (${user.email})` : "";

  return (
    <div className="dark">
      <div className="relative min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-sm space-y-4">
          <Card className="dark:border-white/8 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl">
            <CardHeader className="pb-4">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <KeyRound className="h-5 w-5" />
              </div>
              <CardTitle className="text-base">Ganti Password</CardTitle>
              <CardDescription>
                Masuk sebagai{" "}
                <span className="font-medium text-slate-200">{profile.full_name}</span>
                {emailSuffix}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {mustChange && (
                <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>
                    Password Anda masih password sementara dari administrator. Ganti
                    sekarang sebelum melanjutkan ke aplikasi.
                  </span>
                </div>
              )}

              <ChangePasswordForm />

              <div className="flex items-center justify-between pt-2 text-sm">
                {mustChange ? (
                  <span />
                ) : (
                  <Button asChild variant="ghost" size="sm" className="text-slate-400">
                    <Link href={backHref}>
                      <ArrowLeft className="h-4 w-4" />
                      Kembali
                    </Link>
                  </Button>
                )}
                <form action={logoutAction}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-rose-400 hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    <LogOut className="h-4 w-4" />
                    Keluar
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

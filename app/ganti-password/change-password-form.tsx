"use client";

import { useActionState, useState } from "react";
import { changePasswordAction } from "@/app/actions/auth";
import { passwordChangeError } from "@/lib/password-change";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2 } from "lucide-react";

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, {});
  const [clientError, setClientError] = useState<string | undefined>();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const error = passwordChangeError({
      currentPassword: fd.get("currentPassword") as string | null,
      newPassword: fd.get("newPassword") as string | null,
      confirmPassword: fd.get("confirmPassword") as string | null,
    });
    if (error) {
      e.preventDefault();
      setClientError(error);
      return;
    }
    setClientError(undefined);
  }

  const error = clientError ?? state.error;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Password lama</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword">Password baru</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isPending}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Minimal 8 karakter dan berbeda dari password lama.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Ulangi password baru</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={isPending}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Menyimpan...
          </>
        ) : (
          "Simpan Password Baru"
        )}
      </Button>
    </form>
  );
}

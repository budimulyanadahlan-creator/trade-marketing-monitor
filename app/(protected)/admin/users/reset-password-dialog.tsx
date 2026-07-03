"use client";

import { useActionState, useEffect, useState } from "react";
import { resetUserPasswordAction } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  userId: string;
  userName: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function ResetPasswordDialog({ userId, userName, disabled, disabledReason }: Props) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clientError, setClientError] = useState<string | undefined>();
  const [state, formAction, isPending] = useActionState(resetUserPasswordAction, {});

  useEffect(() => {
    if (state.success) {
      toast.success("Password berhasil direset");
      setOpen(false);
    }
  }, [state.success]);

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) {
      setPassword("");
      setConfirmPassword("");
      setClientError(undefined);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (password.length < 8) {
      e.preventDefault();
      setClientError("Password minimal 8 karakter");
      return;
    }
    if (password !== confirmPassword) {
      e.preventDefault();
      setClientError("Password dan konfirmasi password tidak cocok");
      return;
    }
    setClientError(undefined);
  }

  const errorMessage = clientError ?? state.error;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} title={disabledReason}>
          <KeyRound className="h-3 w-3" />
          Reset Password
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-slate-400">
          Atur password baru untuk{" "}
          <span className="font-medium text-slate-200">{userName}</span>.
        </p>

        <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="id" value={userId} />

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rp-password">Password Baru</Label>
            <Input
              id="rp-password"
              name="password"
              type="password"
              placeholder="Min. 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rp-confirm-password">Ulangi Password Baru</Label>
            <Input
              id="rp-confirm-password"
              name="confirmPassword"
              type="password"
              placeholder="Min. 8 karakter"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isPending}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Reset Password"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

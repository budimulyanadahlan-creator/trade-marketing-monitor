"use client";

import { useState, useTransition } from "react";
import { toggleUserActiveAction } from "@/app/actions/admin-users";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface ToggleActiveButtonProps {
  userId: string;
  isActive: boolean;
  /** Button is disabled — either self or role too high to manage */
  disabled: boolean;
  disabledReason?: string;
}

export function ToggleActiveButton({
  userId,
  isActive,
  disabled,
  disabledReason,
}: ToggleActiveButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [currentIsActive, setCurrentIsActive] = useState(isActive);

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleUserActiveAction(userId, !currentIsActive);
      if (result.error) {
        toast.error(result.error);
      } else {
        setCurrentIsActive(!currentIsActive);
        toast.success(
          currentIsActive ? "User dinonaktifkan" : "User diaktifkan"
        );
      }
    });
  }

  return (
    <Button
      variant={currentIsActive ? "destructive" : "outline"}
      size="sm"
      onClick={handleToggle}
      disabled={isPending || disabled}
      title={disabledReason}
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : currentIsActive ? (
        "Nonaktifkan"
      ) : (
        "Aktifkan"
      )}
    </Button>
  );
}

"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Calendar } from "./calendar";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  name: string;
  defaultValue?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  name,
  defaultValue,
  disabled,
  placeholder = "Pilih tanggal",
  className,
}: DatePickerProps) {
  const [date, setDate] = React.useState<Date | undefined>(() => {
    if (!defaultValue) return undefined;
    // Parse YYYY-MM-DD without timezone shift
    const [y, m, d] = defaultValue.split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const [open, setOpen] = React.useState(false);

  const formatted = date
    ? date.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <>
      <input
        type="hidden"
        name={name}
        value={
          date
            ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
            : ""
        }
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("w-full justify-start font-normal", className, !date && "text-slate-500")}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
            {formatted ?? placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d);
              setOpen(false);
            }}
            defaultMonth={date}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

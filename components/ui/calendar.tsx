"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col",
        month: "space-y-3",
        month_caption: "flex justify-center pt-1 relative items-center h-8",
        caption_label: "text-sm font-medium text-slate-200",
        nav: "flex items-center justify-between absolute inset-x-0 top-0",
        button_previous:
          "h-7 w-7 flex items-center justify-center rounded-md border border-white/10 bg-transparent text-slate-400 hover:bg-white/8 hover:text-slate-200 transition-colors",
        button_next:
          "h-7 w-7 flex items-center justify-center rounded-md border border-white/10 bg-transparent text-slate-400 hover:bg-white/8 hover:text-slate-200 transition-colors",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-slate-500 w-9 font-normal text-[0.75rem] text-center py-1",
        weeks: "",
        week: "flex w-full mt-1",
        day: "h-9 w-9 text-center text-sm p-0 relative",
        day_button:
          "h-9 w-9 p-0 font-normal rounded-md text-slate-300 hover:bg-white/10 hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500",
        selected:
          "[&>button]:bg-emerald-500 [&>button]:text-white [&>button]:hover:bg-emerald-600 [&>button]:hover:text-white",
        today:
          "[&>button]:bg-white/8 [&>button]:font-semibold [&>button]:text-slate-100",
        outside:
          "[&>button]:text-slate-600 [&>button]:hover:text-slate-500 [&>button]:hover:bg-transparent",
        disabled:
          "[&>button]:text-slate-700 [&>button]:cursor-not-allowed [&>button]:hover:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft {...rest} className="h-4 w-4" />
          ) : (
            <ChevronRight {...rest} className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };

"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { istDateString } from "@pearl/shared";
import { format } from "date-fns";
import { DayPicker, type DropdownProps } from "react-day-picker";
import { isoToDate } from "@/lib/date-picker";
import { cn } from "@/lib/utils";
import { Select } from "./select";

/**
 * The app's calendar (shadcn Calendar over react-day-picker), themed only with token classes.
 * Month / year jump uses the app's own `Select`, never the browser's list (UI rule).
 * Day cells carry `data-day="YYYY-MM-DD"` (react-day-picker), which the e2e helpers click.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  const t = useTranslations("datePicker");
  // "Today" is the IST day (CLAUDE.md), whatever the computer's own time zone says.
  const today = isoToDate(istDateString(new Date()))!;
  return (
    <DayPicker
      today={today}
      // The year list (without these: 100 years back to the end of THIS year only — too short
      // for next year's appointments).
      startMonth={new Date(today.getFullYear() - 100, 0, 1)}
      endMonth={new Date(today.getFullYear() + 10, 11, 31)}
      showOutsideDays={showOutsideDays}
      weekStartsOn={1}
      captionLayout="dropdown"
      className={cn("text-foreground", className)}
      labels={{
        labelPrevious: () => t("prevMonth"),
        labelNext: () => t("nextMonth"),
        labelMonthDropdown: () => t("month"),
        labelYearDropdown: () => t("year"),
        // "Monday 2 November 2026": the day's number as its own word, so the name contains the
        // number shown on the button (axe label-content-name-mismatch).
        labelDayButton: (date, m) =>
          [m.today ? t("today") : null, format(date, "EEEE d MMMM yyyy"), m.selected ? t("selected") : null].filter(Boolean).join(", "),
      }}
      classNames={{
        root: "relative w-fit",
        months: "relative flex flex-col gap-4 sm:flex-row sm:gap-6",
        month: "flex w-full flex-col gap-3",
        // The arrow bar lies over the captions: only its two buttons take clicks, so the Month / Year
        // dropdowns under it stay usable.
        nav: "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between",
        button_previous: navButton,
        button_next: navButton,
        month_caption: "flex h-10 items-center justify-center px-10",
        dropdowns: "flex items-center gap-1.5",
        dropdown_root: "relative",
        caption_label: "text-base font-medium",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-10 text-center text-[0.85rem] font-normal text-muted-foreground select-none",
        week: "mt-1 flex w-full",
        day: cn(
          "relative size-10 p-0 text-center text-[0.95rem] select-none",
          // Range: the band between the ends.
          "[&.rdp-range_middle]:bg-accent first:[&.rdp-range_middle]:rounded-l-xl last:[&.rdp-range_middle]:rounded-r-xl",
          "[&.rdp-range_start]:rounded-l-xl [&.rdp-range_start]:bg-accent [&.rdp-range_end]:rounded-r-xl [&.rdp-range_end]:bg-accent",
          "[&.rdp-range_start.rdp-range_end]:bg-transparent",
        ),
        day_button: cn(
          "flex size-10 cursor-pointer items-center justify-center rounded-xl outline-none",
          "hover:bg-popover-accent focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        ),
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/85 [&.rdp-range_middle>button]:bg-transparent [&.rdp-range_middle>button]:text-foreground [&.rdp-range_middle>button]:hover:bg-popover-accent",
        range_start: "rdp-range_start",
        range_middle: "rdp-range_middle",
        range_end: "rdp-range_end",
        today: "[&>button]:font-semibold [&>button]:underline [&>button]:underline-offset-4",
        outside: "text-muted-foreground [&.rdp-range_middle]:text-muted-foreground",
        disabled: "text-muted-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: c }) => {
          const Icon = orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : ChevronDown;
          return <Icon aria-hidden className={cn("size-5", c)} />;
        },
        Dropdown: CalendarDropdown,
      }}
      {...props}
    />
  );
}

const navButton = cn(
  "pointer-events-auto inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-foreground hover:bg-accent",
  "aria-disabled:pointer-events-none aria-disabled:opacity-40",
);

/** Month / year dropdown in the caption, as the app's themed Select. */
function CalendarDropdown({ options, value, onChange, disabled, "aria-label": ariaLabel }: DropdownProps) {
  return (
    <Select
      value={value === undefined ? "" : String(value)}
      // react-day-picker reads Number(e.target.value), which our Select's event shape satisfies.
      onChange={(e) => onChange?.(e as unknown as React.ChangeEvent<HTMLSelectElement>)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="min-h-9 w-auto gap-1 rounded-lg border-transparent bg-transparent px-2 font-medium hover:bg-accent"
    >
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

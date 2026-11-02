"use client";

import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { istDateString } from "@pearl/shared";
import { useTranslations } from "next-intl";
import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import type { DateRange, Matcher } from "react-day-picker";
import {
  dateToIso,
  displayDate,
  displayDateTime,
  displayMonth,
  displayTime,
  isoToDate,
  joinDateTime,
  matchQuickRange,
  monthValue,
  orderRange,
  QUICK_RANGES,
  quickRange,
  splitDateTime,
  timeOptions,
  type QuickRange,
} from "@/lib/date-picker";
import { SM_UP, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { PickerSurface } from "./picker-surface";
import { Select } from "./select";

/*
 * The app's date / range / date+time / time / month pickers (owner, 02/11/2026: no browser date
 * boxes). Values are the same strings the screens used with the browser boxes, so state, zod
 * schemas and RPC calls don't change:
 *   DatePicker "YYYY-MM-DD" · DateRangePicker {from, to} · DateTimePicker "YYYY-MM-DDTHH:mm"
 *   TimePicker "HH:mm" · MonthPicker "YYYY-MM"   ("" = not set)
 * Each takes the props `Field` passes (id, aria-describedby, aria-invalid), so labels, the error
 * under the field and focus-first-bad-field keep working. The box carries `data-value` (the raw
 * value) for tests.
 */

interface FieldProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/** The closed box: looks like `Input`, opens the picker. */
const PickerTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { icon: ReactNode; text: string; placeholder: string; value: string }
>(function PickerTrigger({ icon, text, placeholder, value, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      // A combobox (like the app's Select), so its name is the field's label and the picked date
      // is its value; a plain button would have to be named by the date it shows (WCAG 2.5.3).
      role="combobox"
      aria-haspopup="dialog"
      // Radix's Trigger fills these in (open state, the pop-up's id); defaults for before it does.
      aria-expanded={props["aria-expanded"] ?? false}
      aria-controls={props["aria-controls"]}
      data-value={value}
      className={cn(
        "flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-xl border border-input bg-background px-3.5 text-left text-base text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-critical",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      <span className="flex shrink-0 text-muted-foreground [&_svg]:size-[1.1rem]">{icon}</span>
      <span className={cn("min-w-0 flex-1 truncate tabular-nums", !text && "text-muted-foreground")}>{text || placeholder}</span>
    </button>
  );
});

function minMaxMatchers(min?: string, max?: string): Matcher[] {
  const out: Matcher[] = [];
  const lo = isoToDate(min);
  const hi = isoToDate(max);
  if (lo) out.push({ before: lo });
  if (hi) out.push({ after: hi });
  return out;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Month to open on: the value, else today kept inside min / max. */
function openingMonth(value: string, min?: string, max?: string): Date {
  const v = isoToDate(value);
  if (v) return firstOfMonth(v);
  const todayIso = istDateString(new Date());
  if (min && todayIso < min) return firstOfMonth(isoToDate(min)!);
  if (max && todayIso > max) return firstOfMonth(isoToDate(max)!);
  return firstOfMonth(isoToDate(todayIso)!);
}

// ── Single date ────────────────────────────────────────────────────────────────────────────

export function DatePicker({
  value,
  onChange,
  min,
  max,
  clearTo = "",
  title,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  /** "YYYY-MM-DD": days before / after can't be picked. */
  min?: string;
  max?: string;
  /** What Clear sets ("" by default; a filter that must always have a day passes its start day). */
  clearTo?: string;
  /** Sheet title on a phone (defaults to "Pick a date"). */
  title?: string;
}) {
  const t = useTranslations("datePicker");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(() => openingMonth(value, min, max));
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setMonth(openingMonth(value, min, max));
    }
    setOpen(next);
  };
  const commit = (v: string) => {
    if (v !== value) onChange(v);
    setOpen(false);
  };
  return (
    <PickerSurface
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("pickDate")}
      onOk={() => commit(draft)}
      onClear={() => commit(clearTo)}
      okDisabled={!draft}
      trigger={
        <PickerTrigger
          {...field}
          icon={<CalendarDays aria-hidden />}
          value={value}
          text={displayDate(value)}
          placeholder={field.placeholder ?? t("placeholderDate")}
        />
      }
    >
      <Calendar
        mode="single"
        autoFocus
        month={month}
        onMonthChange={setMonth}
        selected={isoToDate(draft)}
        onSelect={(d) => d && setDraft(dateToIso(d))}
        disabled={minMaxMatchers(min, max)}
      />
    </PickerSurface>
  );
}

// ── Date range ─────────────────────────────────────────────────────────────────────────────

export interface IsoRange {
  from: string;
  to: string;
}

export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  clearTo = { from: "", to: "" },
  quick = true,
  title,
  ...field
}: FieldProps & {
  value: IsoRange;
  onChange: (value: IsoRange) => void;
  min?: string;
  max?: string;
  /** What Clear sets: a list screen passes the range it opened with (same as its ✕). */
  clearTo?: IsoRange;
  /** Show Today / Last 7 days / … beside the calendar. */
  quick?: boolean;
  title?: string;
}) {
  const t = useTranslations("datePicker");
  const wide = useMediaQuery(SM_UP);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<IsoRange>(value);
  const [month, setMonth] = useState(() => openingMonth(value.from, min, max));
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setMonth(openingMonth(value.from, min, max));
    }
    setOpen(next);
  };
  const commit = (r: IsoRange) => {
    const ordered = orderRange(r.from, r.to || r.from);
    if (ordered.from !== value.from || ordered.to !== value.to) onChange(ordered);
    setOpen(false);
  };
  // Click 1 starts a range, click 2 ends it (either order), click 3 starts again.
  const pick = (day: Date) => {
    const iso = dateToIso(day);
    setDraft((d) => (!d.from || d.to ? { from: iso, to: "" } : orderRange(d.from, iso)));
  };
  const choose = (k: QuickRange) => {
    const r = quickRange(k);
    setDraft(r);
    setMonth(firstOfMonth(isoToDate(r.from)!));
  };
  const chosenQuick = draft.from && draft.to ? matchQuickRange(draft.from, draft.to) : null;
  const selected: DateRange | undefined = draft.from ? { from: isoToDate(draft.from), to: isoToDate(draft.to || draft.from) } : undefined;
  const text = !value.from ? "" : value.to && value.to !== value.from ? `${displayDate(value.from)} – ${displayDate(value.to)}` : displayDate(value.from);

  return (
    <PickerSurface
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("pickRange")}
      onOk={() => commit(draft)}
      onClear={() => commit(clearTo)}
      okDisabled={!draft.from}
      trigger={
        <PickerTrigger
          {...field}
          icon={<CalendarRange aria-hidden />}
          value={value.from || value.to ? `${value.from}..${value.to}` : ""}
          text={text}
          placeholder={field.placeholder ?? t("placeholderRange")}
          className={cn("sm:min-w-64", field.className)}
        />
      }
    >
      <div className={cn("flex gap-3", wide ? "flex-row" : "w-full flex-col items-center")}>
        {quick &&
          (wide ? (
            <ul aria-label={t("quickLabel")} className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border pr-3">
              {QUICK_RANGES.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    aria-pressed={chosenQuick === k}
                    onClick={() => choose(k)}
                    className={cn(
                      "w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-[0.95rem] hover:bg-popover-accent",
                      chosenQuick === k && "bg-accent font-medium",
                    )}
                  >
                    {t(`quick.${k}`)}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Select aria-label={t("quickLabel")} value={chosenQuick ?? ""} onChange={(e) => e.target.value && choose(e.target.value as QuickRange)} className="w-full">
              <option value="">{t("quickPlaceholder")}</option>
              {QUICK_RANGES.map((k) => (
                <option key={k} value={k}>
                  {t(`quick.${k}`)}
                </option>
              ))}
            </Select>
          ))}
        <Calendar
          mode="range"
          autoFocus
          numberOfMonths={wide ? 2 : 1}
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={(_range, day) => pick(day)}
          disabled={minMaxMatchers(min, max)}
        />
      </div>
      <p aria-live="polite" className="text-center text-[0.9rem] text-text-secondary">
        {draft.from
          ? draft.to
            ? `${displayDate(draft.from)} – ${displayDate(draft.to)}`
            : t("pickEnd", { from: displayDate(draft.from) })
          : t("pickStart")}
      </p>
    </PickerSurface>
  );
}

// ── Time ───────────────────────────────────────────────────────────────────────────────────

/** A time dropdown: 12-hour labels, value "HH:mm". `allowEmpty` adds a "—" choice that sets "". */
export function TimePicker({
  value,
  onChange,
  step = 15,
  min,
  max,
  allowEmpty = false,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  /** "HH:mm" */
  min?: string;
  max?: string;
  allowEmpty?: boolean;
}) {
  const t = useTranslations("datePicker");
  return (
    <Select
      id={field.id}
      aria-describedby={field["aria-describedby"]}
      aria-invalid={field["aria-invalid"]}
      aria-label={field["aria-label"]}
      disabled={field.disabled}
      className={cn("sm:min-w-36", field.className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled={!allowEmpty}>
        {allowEmpty ? t("noTime") : (field.placeholder ?? t("placeholderTime"))}
      </option>
      {timeOptions(step, value, min, max).map((v) => (
        <option key={v} value={v}>
          {displayTime(v)}
        </option>
      ))}
    </Select>
  );
}

// ── Date + time ────────────────────────────────────────────────────────────────────────────

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  step = 15,
  defaultTime = "10:00",
  clearTo = "",
  title,
  ...field
}: FieldProps & {
  value: string;
  onChange: (value: string) => void;
  /** "YYYY-MM-DDTHH:mm": earlier days can't be picked, and on that day earlier times aren't listed. */
  min?: string;
  max?: string;
  step?: number;
  /** Time filled in when a day is picked first. */
  defaultTime?: string;
  clearTo?: string;
  title?: string;
}) {
  const t = useTranslations("datePicker");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => splitDateTime(value));
  const lo = splitDateTime(min);
  const hi = splitDateTime(max);
  const [month, setMonth] = useState(() => openingMonth(splitDateTime(value).date, lo.date, hi.date));
  const onOpenChange = (next: boolean) => {
    if (next) {
      const v = splitDateTime(value);
      setDraft(v);
      setMonth(openingMonth(v.date, lo.date, hi.date));
    }
    setOpen(next);
  };
  const commit = (v: string) => {
    if (v !== value) onChange(v);
    setOpen(false);
  };
  // On the min / max day the time list starts / stops at that time.
  const minTime = lo.date && draft.date === lo.date ? lo.time : undefined;
  const maxTime = hi.date && draft.date === hi.date ? hi.time : undefined;
  const pickDay = (d: Date) => {
    const date = dateToIso(d);
    setDraft((cur) => {
      let time = cur.time || defaultTime;
      const floor = lo.date === date ? lo.time : undefined;
      if (floor && time < floor) time = timeOptions(step, "", floor)[0] ?? floor;
      return { date, time };
    });
  };
  const timeBad = Boolean((minTime && draft.time < minTime) || (maxTime && draft.time > maxTime));

  return (
    <PickerSurface
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("pickDateTime")}
      onOk={() => commit(joinDateTime(draft.date, draft.time))}
      onClear={() => commit(clearTo)}
      okDisabled={!draft.date || !draft.time || timeBad}
      trigger={
        <PickerTrigger
          {...field}
          icon={<CalendarDays aria-hidden />}
          value={value}
          text={displayDateTime(value)}
          placeholder={field.placeholder ?? t("placeholderDateTime")}
          className={cn("sm:min-w-56", field.className)}
        />
      }
    >
      <Calendar
        mode="single"
        autoFocus
        month={month}
        onMonthChange={setMonth}
        selected={isoToDate(draft.date)}
        onSelect={(d) => d && pickDay(d)}
        disabled={minMaxMatchers(lo.date || undefined, hi.date || undefined)}
      />
      <div className="flex w-full items-center gap-2">
        <Clock aria-hidden className="size-[1.1rem] shrink-0 text-muted-foreground" />
        <TimePicker
          aria-label={t("time")}
          value={draft.time}
          onChange={(time) => setDraft((d) => ({ ...d, time }))}
          step={step}
          min={minTime}
          max={maxTime}
          className="flex-1"
        />
      </div>
    </PickerSurface>
  );
}

// ── Month ──────────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(2026, i, 1)));

export function MonthPicker({
  value,
  onChange,
  clearTo = "",
  title,
  ...field
}: FieldProps & {
  /** "YYYY-MM" */
  value: string;
  onChange: (value: string) => void;
  clearTo?: string;
  title?: string;
}) {
  const t = useTranslations("datePicker");
  const todayIso = istDateString(new Date());
  const thisYear = Number(todayIso.slice(0, 4));
  const thisMonthIndex = Number(todayIso.slice(5, 7)) - 1;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [year, setYear] = useState(() => (value ? Number(value.slice(0, 4)) : thisYear));
  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
      setYear(value ? Number(value.slice(0, 4)) : thisYear);
    }
    setOpen(next);
  };
  const commit = (v: string) => {
    if (v !== value) onChange(v);
    setOpen(false);
  };
  const nowMonth = monthValue(thisYear, thisMonthIndex);
  return (
    <PickerSurface
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? t("pickMonth")}
      onOk={() => commit(draft)}
      onClear={() => commit(clearTo)}
      okDisabled={!draft}
      trigger={
        <PickerTrigger
          {...field}
          icon={<CalendarDays aria-hidden />}
          value={value}
          text={displayMonth(value, MONTH_NAMES)}
          placeholder={field.placeholder ?? t("placeholderMonth")}
        />
      }
    >
      <div className="flex w-72 max-w-full flex-col gap-2">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label={t("prevYear")} onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span aria-live="polite" className="text-base font-medium tabular-nums">
            {year}
          </span>
          <Button variant="ghost" size="icon" aria-label={t("nextYear")} onClick={() => setYear((y) => y + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <div role="group" aria-label={String(year)} className="grid grid-cols-3 gap-1.5">
          {MONTH_NAMES.map((name, i) => {
            const v = monthValue(year, i);
            const chosen = draft === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={chosen}
                data-month={v}
                onClick={() => setDraft(v)}
                className={cn(
                  "min-h-10 cursor-pointer rounded-xl text-[0.95rem] outline-none hover:bg-popover-accent focus-visible:ring-2 focus-visible:ring-ring",
                  v === nowMonth && "font-semibold underline underline-offset-4",
                  chosen && "bg-primary text-primary-foreground hover:bg-primary/85",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
    </PickerSurface>
  );
}

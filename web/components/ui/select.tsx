"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Radix items can't have an empty value; "" (e.g. "All" or "Choose…") is mapped to this.
const EMPTY = "__empty__";
const toItem = (v: string) => (v === "" ? EMPTY : v);
const fromItem = (v: string) => (v === EMPTY ? "" : v);

interface Option {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

/** Reads <option> children (also inside fragments and arrays from .map). */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    if (child.type === Fragment) {
      out.push(...readOptions(props.children));
    } else if (child.type === "option") {
      out.push({
        value: props.value === undefined ? String(props.children ?? "") : String(props.value),
        label: props.children,
        disabled: Boolean(props.disabled),
      });
    }
  });
  return out;
}

export interface SelectProps {
  value?: string | number;
  /** Same shape as a native select's change event, so callers read e.target.value. */
  onChange?: (event: { target: { value: string } }) => void;
  /** <option value="…">Label</option> elements, as with a native select. */
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * The app's dropdown (UI rule: never the browser's own list). Keyboard, typeahead and screen
 * readers work as with a native select; the list is themed like every other popover.
 */
export function Select({ value, onChange, children, className, disabled, required, name, ...aria }: SelectProps) {
  const options = readOptions(children);
  const current = value === undefined || value === null ? "" : String(value);
  const known = options.some((o) => o.value === current);
  return (
    <S.Root
      value={known ? toItem(current) : ""}
      onValueChange={(v) => onChange?.({ target: { value: fromItem(v) } })}
      disabled={disabled}
      required={required}
      name={name}
    >
      <S.Trigger
        {...aria}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-xl border border-input bg-background px-3.5 text-left text-base text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-critical",
          "data-[placeholder]:text-muted-foreground",
          current === "" && "text-muted-foreground",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <S.Value />
        </span>
        <S.Icon asChild>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 max-h-[min(var(--radix-select-content-available-height),24rem)] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl",
          )}
        >
          <S.Viewport className="p-1.5">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={toItem(o.value)}
                disabled={o.disabled}
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 text-base outline-none select-none",
                  "data-[highlighted]:bg-popover-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <S.ItemIndicator>
                    <Check aria-hidden className="size-5" />
                  </S.ItemIndicator>
                </span>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

"use client";

import { useState, type ComponentProps } from "react";
import { formatINR, rupeesToPaise } from "@pearl/shared";
import { Input } from "@/components/ui/input";

/** Rupee amount field. Holds paise for the app; shows "1,50,000.00" when not editing. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null;
  onChange: (paise: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : formatINR(value, { symbol: false }));
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text-secondary">
        ₹
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        className="pl-9 tabular-nums"
        value={shown}
        onFocus={(e) => {
          const raw = value === null ? "" : (value / 100).toFixed(2).replace(/\.00$/, "");
          // Swap the text in place and keep it selected, so typing replaces the amount instead of appending to it.
          e.currentTarget.value = raw;
          e.currentTarget.select();
          setDraft(raw);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const text = e.target.value.trim();
          if (!text) return onChange(null);
          try {
            const paise = rupeesToPaise(text);
            if (paise >= 0) onChange(paise);
          } catch {
            // keep typing; the value updates once it is a valid amount
          }
        }}
        onBlur={() => setDraft(null)}
        {...props}
      />
    </div>
  );
}

/** GST rate picker in basis points (the unit packages/shared/src/gst.ts uses). */
export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;

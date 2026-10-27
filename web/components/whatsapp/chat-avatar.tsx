import { cn } from "@/lib/utils";

const PALETTE = 8; // --chart-1 … --chart-8, the categorical order

/** Same name → same colour, every time. */
function colourIndex(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % PALETTE) + 1;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p));
  if (parts.length === 0) return "#";
  return (parts[0]![0]! + (parts.length > 1 ? parts.at(-1)![0]! : "")).toUpperCase();
}

/** Round avatar with initials, tinted from the chart palette (CSS variables, both themes). */
export function ChatAvatar({ name, className }: { name: string; className?: string }) {
  const n = colourIndex(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[0.95rem] font-semibold text-foreground", className)}
      style={{ backgroundColor: `color-mix(in srgb, var(--chart-${n}) 35%, var(--card))` }}
    >
      {initials(name)}
    </span>
  );
}

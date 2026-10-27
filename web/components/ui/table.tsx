"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Plain, readable tables: big rows, hairline borders, horizontal scroll on small screens.
 * A table wider than its box can be scrolled with the keyboard: the box takes focus then
 * (only then, so narrow tables add no extra Tab stop). `relative`: screen-reader-only labels
 * (absolutely placed) stay inside the scrolling box instead of widening the whole page.
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      tabIndex={scrolls ? 0 : undefined}
      className="relative w-full overflow-x-auto rounded-2xl border border-border"
    >
      <table className={cn("w-full border-collapse text-left text-base", className)} {...props} />
    </div>
  );
}

export function THead(props: ComponentProps<"thead">) {
  return <thead className="bg-secondary text-[0.9rem] text-text-secondary" {...props} />;
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("px-3 py-2.5 font-medium whitespace-nowrap sm:px-4", className)} {...props} />;
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-t border-border", className)} {...props} />;
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  // On a phone a cell keeps its text on one line and the table scrolls sideways, instead of
  // breaking names and numbers over 3–4 lines. A cell of running text opts out with `wrapText`.
  return <td className={cn("px-3 py-2.5 align-middle max-sm:whitespace-nowrap sm:px-4", className)} {...props} />;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="border-t border-border">
      <td colSpan={colSpan} className="px-4 py-8 text-center text-text-secondary">
        {children}
      </td>
    </tr>
  );
}

/** For a TD holding running text (notes, errors, change lists): it wraps on a phone too. */
export const wrapText = "max-sm:min-w-64 max-sm:whitespace-normal";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldError, Label } from "./input";

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-[0.9rem] text-text-secondary">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

// The app dropdown (custom, themed): see ./select.tsx. Re-exported so forms import one place.
export { Select } from "./select";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground",
        "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-status-critical",
        className,
      )}
      {...props}
    />
  );
}

/** Big tick box with its label (whole row is clickable, ≥ 44 px). */
export function Checkbox({ label, hint, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-xl py-2", className)}>
      <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-[var(--primary)]" {...props} />
      <span className="flex flex-col">
        <span className="text-base">{label}</span>
        {hint && <span className="text-[0.9rem] text-text-secondary">{hint}</span>}
      </span>
    </label>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

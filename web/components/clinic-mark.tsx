import { publicAssetUrl } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

/** Clinic logo from Admin → Clinic profile, or the first letter of the clinic name. */
export function ClinicMark({
  name,
  logoPath,
  size = 36,
  className,
}: {
  name: string | null;
  logoPath: string | null;
  size?: number;
  className?: string;
}) {
  const url = publicAssetUrl(logoPath);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- tiny public logo, no optimisation needed
    return <img src={url} alt={name ?? ""} width={size} height={size} className={cn("rounded-full object-contain", className)} />;
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-[0.95rem] font-semibold text-primary-foreground",
        className,
      )}
    >
      {(name?.trim()[0] ?? "C").toUpperCase()}
    </span>
  );
}

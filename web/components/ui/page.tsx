import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The root of every signed-in page: one vertical rhythm (gap-5 between blocks), full width.
 * Children carry no top/bottom margins of their own; the gap is the only space between them.
 */
export function Page({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col gap-5", className)} {...props} />;
}

/** "← Back to …" above a title. Small, but a full-size target. */
export function BackLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "-ml-2 inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full px-2 text-text-secondary hover:bg-accent hover:text-foreground [&_svg]:size-4",
        className,
      )}
    >
      <ArrowLeft aria-hidden />
      {children}
    </Link>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Link back to the parent page (admin sub-pages, detail pages). */
  back?: { href: string; label: ReactNode };
  /** Status badges beside the title. */
  badges?: ReactNode;
  /** One line of facts under the title (number · date · person). */
  meta?: ReactNode;
}

/**
 * The one page title block: back link, title (one size everywhere), badges, meta line,
 * description and actions. No outer margin: the page's gap spaces it.
 */
export function PageHeader({ title, description, actions, back, badges, meta }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="min-w-0 text-[1.75rem] leading-tight font-semibold tracking-tight break-words">{title}</h1>
            {badges}
          </div>
          {meta && <p className="text-text-secondary">{meta}</p>}
          {description && <p className="max-w-prose text-text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * The Save bar of a long form: stays at the bottom of the screen while the form scrolls, so the
 * one main button is always in reach (and the page has only that one).
 */
export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6 xl:-mx-8 xl:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A record's page header (bill, lead, IP stay, …): the same block, always with a back link. */
export function DetailHeader(props: PageHeaderProps & { back: NonNullable<PageHeaderProps["back"]> }) {
  return <PageHeader {...props} />;
}

/** The back link every admin sub-page shows (to the Admin hub). */
export function useAdminBack(): NonNullable<PageHeaderProps["back"]> {
  const t = useTranslations("adminHub");
  return { href: "/admin", label: t("backToAdmin") };
}

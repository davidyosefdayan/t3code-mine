/**
 * Personal build: the body of a full page (Usage, and next Pull requests and
 * Skills), drawn like Settings: a titled section over a card. The rules are in
 * docs/internals/web-ui.md under "Page anatomy".
 */
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Insets that line a section title up with the text inside its card. */
const INSET = "px-3 sm:px-4";

export function PageSection({
  title,
  description,
  action,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** One control for the whole section, such as a segmented view switch. */
  readonly action?: ReactNode;
}) {
  return (
    <section {...props} className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      <div className={cn("flex min-h-7 items-start justify-between gap-4", INSET)}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex min-h-7 items-center gap-2 text-base font-semibold text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex min-h-7 shrink-0 items-center">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PageCard({
  title,
  aside,
  footer,
  flush = false,
  children,
  className,
}: {
  readonly title?: ReactNode;
  /** A count or short fact, right of the title. */
  readonly aside?: ReactNode;
  /** Notes about the card's numbers, under a divider. */
  readonly footer?: ReactNode;
  /** Rows that bring their own padding, such as a hoverable list or a table. */
  readonly flush?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 rounded-xl border border-border/60 bg-card/40 shadow-xs/5", className)}
    >
      {title ? (
        <div className={cn("flex items-baseline justify-between gap-3 pt-3.5", INSET)}>
          <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{title}</h3>
          {aside ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{aside}</span>
          ) : null}
        </div>
      ) : null}
      <div className={cn(flush ? "py-1.5" : cn("py-3.5", INSET), flush && title && "pt-2")}>
        {children}
      </div>
      {footer ? (
        <div
          className={cn(
            "flex flex-col gap-1 border-t border-border/50 py-2.5 text-xs text-muted-foreground",
            INSET,
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Nothing to show, or not yet: one muted line in an empty card. */
export function PageMessage({ children }: { readonly children: ReactNode }) {
  return (
    <PageCard>
      <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
    </PageCard>
  );
}

export function PageStat({
  label,
  value,
  detail,
  size = "default",
  className,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  /** `hero` is the one number a page leads with. */
  readonly size?: "default" | "hero";
  readonly className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-foreground tabular-nums",
          size === "hero"
            ? "text-4xl font-semibold tracking-tight"
            : "text-lg font-semibold leading-snug",
          className,
        )}
      >
        {value}
      </span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

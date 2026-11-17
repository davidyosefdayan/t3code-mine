/**
 * Personal build: the frame every full page shares — one header (where you are on the left,
 * actions on the right) over one scrolling body. The rules are in docs/internals/web-ui.md
 * under "Page anatomy".
 */
import {
  createContext,
  Fragment,
  use,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useGT } from "gt-react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";

/** Where a page's body may portal into its header; undefined outside a `Page`. */
const PageHeaderSlots = createContext<
  { readonly actions: HTMLElement | null; readonly tabs: HTMLElement | null } | undefined
>(undefined);

/** True inside a `Page`, so a shared detail view drops its own header for the page's. */
export function useInPage(): boolean {
  return use(PageHeaderSlots) !== undefined;
}

/**
 * For a scroller a shared view already owns: fades under the header and centres each child at
 * reading width, the chat column's. `PageBody` is the same scroller for a page's own content.
 */
// No bottom padding here: a view with a floating composer reserves its own room below.
// Space for the scrollbar is always kept, so the column never shifts when one appears.
export const PAGE_SCROLLER =
  "topbar-scroll-fade pt-2 [scrollbar-gutter:stable] [&>*]:mx-auto [&>*]:w-full";
export const PAGE_READING_COLUMN = "[&>*]:max-w-3xl";
const PAGE_WIDE_COLUMN = "[&>*]:max-w-6xl";

export function Page({
  path,
  actions,
  children,
}: {
  /** Where you are, without the page's own name (the sidebar shows it). Last item is current. */
  readonly path: ReadonlyArray<ReactNode>;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [tabsSlot, setTabsSlot] = useState<HTMLElement | null>(null);
  const items = path.filter((item) => item !== null && item !== undefined && item !== false);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <WorkspacePageHeader electron={isElectron} className="gap-3">
        {items.length > 0 ? (
          <WorkspaceBreadcrumb ariaLabel={gt("Location")} className="min-w-0">
            {items.map((item, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- path items are positional
              <Fragment key={index}>
                {index > 0 ? <WorkspaceBreadcrumbSeparator /> : null}
                <WorkspaceBreadcrumbItem
                  current={index === items.length - 1}
                  className={index === items.length - 1 ? "min-w-0" : ""}
                >
                  {item}
                </WorkspaceBreadcrumbItem>
              </Fragment>
            ))}
          </WorkspaceBreadcrumb>
        ) : null}
        <div ref={setTabsSlot} className="flex shrink-0 items-center empty:hidden" />
        <div
          ref={setActionsSlot}
          className="ms-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
        >
          {actions}
        </div>
      </WorkspacePageHeader>
      <PageHeaderSlots value={{ actions: actionsSlot, tabs: tabsSlot }}>{children}</PageHeaderSlots>
    </div>
  );
}

/** Puts actions that only the body knows (they need loaded data) into the page header. */
export function PageHeaderActions({ children }: { readonly children: ReactNode }) {
  const slot = use(PageHeaderSlots)?.actions;
  return slot ? createPortal(children, slot) : null;
}

/** Puts the open item's tabs into the page header, right after where you are. */
export function PageHeaderTabs({ children }: { readonly children: ReactNode }) {
  const slot = use(PageHeaderSlots)?.tabs;
  return slot ? createPortal(children, slot) : null;
}

/** The page's scroller, for content the page draws itself. Each child is one centred block. */
export function PageBody({
  width = "reading",
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div"> & { readonly width?: "reading" | "wide" }) {
  return (
    <div
      {...props}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-4 pb-8",
        PAGE_SCROLLER,
        width === "reading" ? PAGE_READING_COLUMN : PAGE_WIDE_COLUMN,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Nothing open: the page's icon, a title and one line, as Skills shows an empty list. */
export function PageEmpty({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

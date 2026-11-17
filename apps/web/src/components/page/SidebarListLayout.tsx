/**
 * Personal build: the frame of a sidebar list (threads, skills, pull
 * requests): the search bar pinned on top, then the list, with the same
 * insets on every page, so titles, search, and the first row line up.
 */
import type { ReactNode, RefObject } from "react";

import { SidebarGroupButton } from "../sidebar/ThreadRowParts";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";

export function SidebarListLayout({
  scrollRef,
  ...props
}: {
  /** The search bar row. */
  header: ReactNode;
  children: ReactNode;
  /** A list that measures its own scroller (infinite loading, say) scrolls here instead. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  if (scrollRef) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SidebarGroup className="z-[1] shrink-0">{props.header}</SidebarGroup>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* The list group's inset, without the top a fixed header already provides. */}
          <div className="px-(--sidebar-content-inset) pb-(--sidebar-content-inset)">
            {props.children}
          </div>
        </div>
      </div>
    );
  }
  return (
    <SidebarContent
      className="min-h-full"
      fixedHeader={<SidebarGroup className="z-[1]">{props.header}</SidebarGroup>}
    >
      <SidebarGroup>{props.children}</SidebarGroup>
    </SidebarContent>
  );
}

/** A group's title in a sidebar list: the Threads group title, which collapses its group. */
export function SidebarListGroup(props: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={props.label} className="flex flex-col gap-0.5 pt-3">
      <SidebarGroupButton
        label={props.label}
        count={props.count}
        expanded={props.expanded}
        onToggle={props.onToggle}
      />
      {props.expanded ? props.children : null}
    </section>
  );
}

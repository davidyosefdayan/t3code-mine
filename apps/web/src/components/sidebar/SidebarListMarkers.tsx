import { SidebarGroupButton } from "./ThreadRowParts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useLayoutEffect } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarThreadRow";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  revealOverflow?: boolean;
  "data-testid"?: string;
}) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the projected drop box inside the scroll viewport as drag transforms move it
  useLayoutEffect(() => {
    if (props.revealOverflow && transform?.y !== undefined) {
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [node, props.revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
      revealOverflow={props.marker === "settled-placeholder" && props.showHint}
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/** Personal build: a group's id in the keyboard tree; its rows name it as their parent. */
export function sidebarShelfId(marker: SidebarListMarker | undefined): string {
  if (marker === undefined) return "new";
  if (marker === "pinned-divider" || marker === "active-placeholder") return "active";
  if (marker === "settled-placeholder") return "settled";
  return marker.replace(/-header$/, "");
}

// Personal build: one title style for every group (New threads, Unread,
// Pinned, Open, Working, Snoozed, Settled); clicking it collapses the group.
export function SidebarSectionHeader(props: {
  // The group's place in the drag list, so drops can tell which group they
  // land in. The New threads title sits above the list and has none.
  marker?: SidebarListMarker;
  label: string;
  count: number;
  className?: string;
  isDropTarget?: boolean;
  // The count reads as a badge: these threads are waiting on you.
  emphasis?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
}) {
  const button = (
    <SidebarGroupButton
      label={props.label}
      count={props.count}
      expanded={props.toggle.expanded}
      onToggle={props.toggle.onToggle}
      isDropTarget={props.isDropTarget}
      emphasis={props.emphasis}
      rowId={`shelf:${sidebarShelfId(props.marker)}`}
    />
  );
  if (props.marker === undefined) return <li className="list-none pt-3">{button}</li>;
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("pt-3", props.className)}
    >
      {button}
    </SortableSidebarMarker>
  );
}

import { describe, expect, it } from "vite-plus/test";

import {
  resolveSidebarDropTarget,
  resolveSidebarDropVerb,
  sidebarMarkerId,
  sortArrangedThreads,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

// Personal build: Pinned and Open are homes you arrange; Unread sits above
// them and follows live status.

describe("sortArrangedThreads", () => {
  const row = (id: string, orderKey: string | null, arrivedAt: string) => ({
    id,
    environmentId: "env",
    orderKey,
    arrivedAt,
  });
  const sort = (rows: ReturnType<typeof row>[]) =>
    sortArrangedThreads(
      rows,
      (thread) => thread.orderKey,
      (thread) => thread.arrivedAt,
    ).map((thread) => thread.id);

  it("keeps placed rows in their saved order and adds new arrivals at the bottom", () => {
    expect(
      sort([
        row("newest", null, "2026-10-14T12:00:00.000Z"),
        row("second", "n", "2026-10-14T13:00:00.000Z"),
        row("older", null, "2026-10-01T12:00:00.000Z"),
        row("first", "c", "2026-10-13T12:00:00.000Z"),
      ]),
    ).toEqual(["first", "second", "older", "newest"]);
  });
});

describe("resolveSidebarDropTarget with Unread above the pins", () => {
  const thread = (key: string, section: SidebarSection): SidebarListItem => ({
    kind: "thread",
    key,
    section,
  });
  const marker = (name: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker: name });
  const items: readonly SidebarListItem[] = [
    marker("unread-header"),
    thread("u1", "unread"),
    marker("pinned-header"),
    thread("p1", "pinned"),
    marker("pinned-divider"),
    marker("active-placeholder"),
    thread("a1", "active"),
    thread("a2", "active"),
    marker("working-header"),
    thread("w1", "working"),
  ];

  it("lands first in Pinned when dropped on the Pinned title, leaving Unread out", () => {
    expect(resolveSidebarDropTarget(items, "a2", sidebarMarkerId("pinned-header"))).toEqual({
      section: "pinned",
      pinnedOrder: ["a2", "p1"],
      activeOrder: ["a1"],
    });
  });

  it("reorders Open without counting Unread rows", () => {
    expect(resolveSidebarDropTarget(items, "a2", "a1")).toEqual({
      section: "active",
      pinnedOrder: ["p1"],
      activeOrder: ["a2", "a1"],
    });
  });

  it("never drops into Unread", () => {
    expect(resolveSidebarDropTarget(items, "a1", "u1")).toBeNull();
    expect(resolveSidebarDropVerb("active", "unread")).toBeNull();
  });
});

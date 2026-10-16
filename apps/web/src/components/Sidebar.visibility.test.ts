import { describe, expect, it } from "vite-plus/test";

import { getVisibleSidebarGroupThreads } from "./Sidebar.visibility";

const threads = [{ key: "local:running" }, { key: "remote:running" }];
const threadKey = (thread: (typeof threads)[number]) => thread.key;

describe("getVisibleSidebarGroupThreads", () => {
  it.each([
    {
      name: "startup with an expanded working group",
      collapsed: false,
      routeThreadKey: null,
      expected: threads,
    },
    {
      name: "startup with a collapsed working group",
      collapsed: true,
      routeThreadKey: null,
      expected: [],
    },
    {
      name: "open thread retained in its environment",
      collapsed: true,
      routeThreadKey: "remote:running",
      expected: [threads[1]],
    },
    {
      name: "open thread outside the group",
      collapsed: true,
      routeThreadKey: "local:other",
      expected: [],
    },
    {
      name: "expanded group with an open thread",
      collapsed: false,
      routeThreadKey: "local:running",
      expected: threads,
    },
  ])("selects visible rows for $name", ({ collapsed, routeThreadKey, expected }) => {
    expect(
      getVisibleSidebarGroupThreads({ threads, collapsed, routeThreadKey, threadKey }),
    ).toEqual(expected);
  });

  it("restores all rows when the group is expanded after being collapsed", () => {
    const input = { threads, routeThreadKey: "local:running", threadKey };
    expect(getVisibleSidebarGroupThreads({ ...input, collapsed: true })).toEqual([threads[0]]);
    expect(getVisibleSidebarGroupThreads({ ...input, collapsed: false })).toBe(threads);
  });
});

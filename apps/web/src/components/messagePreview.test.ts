import { describe, expect, it } from "vite-plus/test";

import { sidebarMessagePreview } from "./messagePreview";

describe("sidebarMessagePreview", () => {
  it("reads like a messages-app preview", () => {
    expect(
      sidebarMessagePreview(
        "# Sentry list\n\nI reviewed **27 issue groups** in `apps/web`, see [the PR](https://x.y).\n\n1. First",
      ),
    ).toBe("Sentry list I reviewed 27 issue groups in apps/web, see the PR. First");
  });

  it("returns nothing for empty or markup-only text", () => {
    expect(sidebarMessagePreview(null)).toBeNull();
    expect(sidebarMessagePreview("  \n ")).toBeNull();
    expect(sidebarMessagePreview("```\n```")).toBeNull();
  });
});

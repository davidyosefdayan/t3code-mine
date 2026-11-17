import { redirect, useLocation } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { useCommitOnBlur } from "../hooks/useCommitOnBlur";
import { AppRouteModal } from "./AppRouteModal";

vi.mock("./chat/GlobalVoiceInputIndicator", () => ({ GlobalVoiceInputIndicator: () => null }));

function CommitOnBlurField({ onCommit }: { onCommit: (next: string) => void }) {
  return <input aria-label="Instructions" {...useCommitOnBlur("", onCommit)} />;
}

describe("AppRouteModal", () => {
  it("commits a focused field when Esc closes it", async () => {
    const onCommit = vi.fn();
    await using _screen = await render(
      <AppRouteModal label="Settings">
        <CommitOnBlurField onCommit={onCommit} />
      </AppRouteModal>,
      { router: "/settings/general" },
    );

    await page.getByRole("textbox", { name: "Instructions" }).fill("Keep titles short");
    await userEvent.keyboard("{Escape}");

    expect(onCommit).toHaveBeenCalledWith("Keep titles short");
  });

  // regression: #42075. Navigation: Back (mod+[) leaves the Settings route without closing it.
  it("commits a focused field when the route goes back", async () => {
    const onCommit = vi.fn();
    function SettingsRoute() {
      const pathname = useLocation({ select: (location) => location.pathname });
      return pathname.startsWith("/settings") ? (
        <AppRouteModal label="Settings">
          <CommitOnBlurField onCommit={onCommit} />
        </AppRouteModal>
      ) : null;
    }
    await using screen = await render(<SettingsRoute />, { router: "/" });
    // The app redirects /settings, and the router skips onBeforeNavigate after a redirect.
    screen.router!.routeTree.update({
      beforeLoad: ({ location }: { location: { pathname: string } }) => {
        if (location.pathname === "/settings") throw redirect({ to: "/settings/general" });
      },
    });
    await screen.router!.navigate({ to: "/settings" });

    await page.getByRole("textbox", { name: "Instructions" }).fill("Keep titles short");
    screen.router!.history.back();

    await expect
      .element(page.getByRole("textbox", { name: "Instructions" }))
      .not.toBeInTheDocument();
    expect(onCommit).toHaveBeenCalledWith("Keep titles short");
  });

  // Personal build: Settings and Usage are pages, not upstream's modal, so its focus and
  // foreign-Esc cases do not apply.
});

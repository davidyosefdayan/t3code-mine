import { useAtomValue } from "@effect/atom-react";
import { useCanGoBack, useLocation, useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { T3Wordmark } from "../T3Wordmark";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// The router only reports back history. Chromium's Navigation API knows about
// forward entries too; re-read it whenever the location changes. Where the API
// is missing, forward stays enabled (the old behavior).
function useCanGoForward(): boolean {
  useLocation({ select: (location) => location.href });
  const navigation = (window as { navigation?: { canGoForward?: boolean } }).navigation;
  return navigation?.canGoForward ?? true;
}

function TopBarButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

// The window's top strip (like Slack and ChatGPT): the macOS window buttons,
// the app name, history navigation, and a search field that opens the command
// palette. The rail and panel start below it; sidebar toggles stay in the
// sidebars themselves.
export function AppTopBar() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const canGoForward = useCanGoForward();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const shortcut = (command: "commandPalette.toggle") =>
    shortcutLabelForCommand(keybindings, command, { context: { usagePageOpen } });
  const paletteShortcut = shortcut("commandPalette.toggle");
  return (
    <header
      data-app-topbar=""
      // pt-2 matches the panel's 0.5rem top margin, so the controls center between
      // the window top and the panel rather than within the bar alone. On Windows
      // and Linux the native window buttons overlay the bar's right end.
      className="drag-region fixed inset-x-0 top-0 z-30 hidden h-(--app-topbar-height) items-center gap-3 bg-sidebar-shell ps-(--app-topbar-start) pe-(--app-topbar-end) pt-2 md:flex [&_button]:[-webkit-app-region:no-drag]"
    >
      <div className="flex items-center gap-0.5">
        <span className="me-2 inline-flex items-baseline gap-1 text-sm font-medium tracking-tight text-sidebar-foreground">
          <T3Wordmark aria-label="T3" className="h-[1cap] w-auto shrink-0" />
          <span className="text-sidebar-muted-foreground">Code</span>
        </span>
        <TopBarButton label="Back" disabled={!canGoBack} onClick={() => router.history.back()}>
          <ArrowLeftIcon />
        </TopBarButton>
        <TopBarButton
          label="Forward"
          disabled={!canGoForward}
          onClick={() => router.history.forward()}
        >
          <ArrowRightIcon />
        </TopBarButton>
      </div>
      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="ms-auto flex h-7 w-full max-w-xl cursor-pointer items-center gap-2 rounded-lg bg-chip px-2.5 text-start text-xs text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search threads, projects, and commands</span>
        {paletteShortcut ? (
          <kbd className="shrink-0 font-sans text-2xs opacity-70">{paletteShortcut}</kbd>
        ) : null}
      </button>
    </header>
  );
}

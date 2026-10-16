import { ChartColumnBigIcon, Icon, MessagesSquareIcon, type IconNode } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { cn } from "../../lib/utils";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { useEnvironments } from "../../state/environments";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SkillsIcon } from "../skills/SkillsIcon";
import { ForkUpdateRailButton } from "./ForkUpdateRailButton";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { useNavigateToMainApp } from "./mainAppLocation";
import { useNeedsYouCount } from "../needsYouCount";

// Route chunks behind the rail: the thread views and each rail page.
const RAIL_ROUTE_IDS = [
  "/_chat/",
  "/_chat/$environmentId/$threadId",
  "/_chat/draft/$draftId",
  "/_chat/pull-requests",
  "/usage",
  "/skills",
  "/settings",
  "/settings/general",
] as const;

// Lucide's settings gear, with the hub as a second subpath of the same shape so
// the filled (active) gear keeps its hole under evenodd.
const settingsGear: IconNode = [
  [
    "path",
    {
      d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0",
      fillRule: "evenodd",
      key: "gear",
    },
  ],
];

// Personal build: a Slack-style app rail, one icon per page of the app, left of
// the page's sidebar. Threads is home; Pull requests, Usage, Skills, and Settings
// are separate pages rather than footer buttons.
// `activeFill` selects the parts of the icon that fill in on the active page.
// `dot` marks the page as having something waiting for you.
function RailButton(props: {
  label: string;
  active: boolean;
  activeFill: string;
  dot?: boolean;
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
            aria-current={props.active ? "page" : undefined}
            onClick={props.onClick}
            className={cn(
              "relative flex size-9 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-[18px]",
              props.active && [
                "bg-row-active text-sidebar-foreground hover:bg-row-active",
                props.activeFill,
              ],
            )}
          />
        }
      >
        {props.children}
        {props.dot ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar-shell"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="right">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function AppRail() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { environments } = useEnvironments();
  // Builds without an update feed (unsigned Mac builds, the browser) have nothing to offer.
  const desktopUpdatesEnabled = useDesktopUpdateState()?.enabled === true;
  const router = useRouter();
  const needsYouCount = useNeedsYouCount();
  // Pages are split chunks. Load every rail destination once the app is idle so
  // switching pages never renders an empty frame while code downloads.
  useEffect(() => {
    const preload = () => {
      // Settings pages switch from the settings nav, not the rail, so load
      // them all: a missing chunk leaves the old page up while the new one loads.
      const settingsIds = Object.keys(router.routesById).filter((id) =>
        id.startsWith("/settings/"),
      );
      for (const id of [...RAIL_ROUTE_IDS, ...settingsIds]) {
        const route = router.routesById[id as keyof typeof router.routesById];
        if (route === undefined) continue;
        void Promise.resolve(router.loadRouteChunk(route)).catch(() => {});
      }
    };
    const idle = window.requestIdleCallback?.(preload) ?? window.setTimeout(preload, 1500);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [router]);
  // Capabilities arrive after first paint. Keep the button while they are
  // unknown and drop it only once every environment has said no, so startup
  // never pops it in and pushes the rest of the rail down.
  const pullRequestsSupported =
    environments.length === 0 ||
    environments.some(
      (environment) =>
        !environment.serverConfig ||
        environment.serverConfig.environment.capabilities.pullRequests === true,
    );
  const page = pathname.startsWith("/settings")
    ? "settings"
    : pathname.startsWith("/skills")
      ? "skills"
      : pathname.startsWith("/usage")
        ? "usage"
        : pathname.startsWith("/pull-requests")
          ? "pull-requests"
          : "threads";
  return (
    // pl-px: the panel's 1px left border blends into the shell, so its visible
    // edge starts a pixel past the rail. Padding by the same pixel centers the
    // icons between the window edge and the panel as seen.
    <nav
      aria-label="App"
      data-app-sidebar=""
      data-app-rail=""
      className="relative z-20 hidden h-[calc(100dvh-var(--app-topbar-height))] w-(--app-rail-width) shrink-0 flex-col items-center gap-1.5 bg-sidebar-shell py-(--app-rail-inset) pl-px md:flex [&_button]:[-webkit-app-region:no-drag]"
    >
      <RailButton
        label={needsYouCount > 0 ? `Threads, ${needsYouCount} need you` : "Threads"}
        active={page === "threads"}
        dot={needsYouCount > 0}
        activeFill="[&_path:first-child]:fill-current"
        onClick={() => void navigateToMainApp()}
      >
        <MessagesSquareIcon />
      </RailButton>
      {pullRequestsSupported ? (
        <RailButton
          label="Pull requests"
          active={page === "pull-requests"}
          activeFill="[&_circle]:fill-current"
          onClick={() =>
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() })
          }
        >
          <PullRequestGlyph.pullRequest />
        </RailButton>
      ) : null}
      <RailButton
        label="Usage"
        active={page === "usage"}
        activeFill="[&_rect]:fill-current"
        onClick={() => void navigate({ to: "/usage" })}
      >
        <ChartColumnBigIcon />
      </RailButton>
      <RailButton
        label="Skills"
        active={page === "skills"}
        activeFill="[&_[data-fill]]:fill-current [&_[data-text]]:opacity-0"
        // The Skills route is typed once it lands; href keeps this independent of it.
        onClick={() => void router.navigate({ href: "/skills" })}
      >
        <SkillsIcon />
      </RailButton>
      <div className="flex-1" />
      {/* The maintainer's builds move the fork onto upstream releases (set at
          build time; see ForkUpdateRailButton) and leave upstream's update
          control out. Everyone else's builds get the fork's own published
          releases through the app's built-in updater. */}
      {import.meta.env.VITE_T3_FORK_MAINTAINER === "1" ? (
        <ForkUpdateRailButton />
      ) : desktopUpdatesEnabled ? (
        <ul>
          <SidebarUpdatePill />
        </ul>
      ) : null}
      <RailButton
        label="Settings"
        active={page === "settings"}
        activeFill="[&_path]:fill-current"
        onClick={() => void navigate({ to: "/settings" })}
      >
        <Icon iconNode={settingsGear} />
      </RailButton>
    </nav>
  );
}

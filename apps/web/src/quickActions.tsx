// Personal build: command palette rows pinned to the top bar. A pin stores the row's value
// and title; clicking runs the row through the palette, so any row can be pinned without
// moving its code out of CommandPalette.tsx.
import type { PinnedQuickAction } from "@t3tools/contracts/settings";
import {
  BugIcon,
  ChartColumnBigIcon,
  FileSearchIcon,
  FolderGit2Icon,
  LinkIcon,
  MessageSquareDashedIcon,
  MonitorIcon,
  PaletteIcon,
  PinIcon,
  PlugIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShuffleIcon,
  SquarePenIcon,
  TextSearchIcon,
  UserPlusIcon,
} from "lucide-react";

import { useAtomValue } from "@effect/atom-react";
import { threadPullRequestLinkMode } from "@t3tools/client-runtime/thread-pull-request-compatibility";
import type { EnvironmentId } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useLocation } from "@tanstack/react-router";
import type { ComponentType } from "react";

import { runCommandPaletteItem } from "./commandPaletteBus";
import type { CommandPaletteItemPin } from "./components/CommandPalette.logic";
import { canShareWithGuestAtom } from "./components/chat/guestShareAvailability";
import { previewBridge } from "./components/preview/previewBridge";
import { promptLinkFor, promptLinkRepositoryOf } from "./components/promptLinks/copyPromptLink";
import { useComposerDraftStore } from "./composerDraftStore";
import { useOpenPanelPullRequestUrl } from "./hooks/useOpenPanelPullRequestUrl";
import { PullRequestGlyph } from "./components/pullRequest/pullRequestIcons";
import { stackedThreadToast, toastManager } from "./components/ui/toast";
import { updateClientSettings, useClientSettings } from "./hooks/useSettings";
import { setTheme } from "./hooks/useTheme";
import { useThreadRouteTarget } from "./hooks/useThreadRouteTarget";
import { MINE_THEMES } from "./mineThemes";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanel,
  useRightPanelStore,
} from "./rightPanelStore";
import { useEnvironments } from "./state/environments";
import { useProjects, useQuietThreadShell, useServerConfigs } from "./state/entities";

/** The top bar icon per palette row; rows without one get a pin. */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "action:new-thread": SquarePenIcon,
  "action:new-thread-in": SquarePenIcon,
  "action:new-thread-without-project": MessageSquareDashedIcon,
  "action:triage": BugIcon,
  "find-current-thread": TextSearchIcon,
  "find-in-browser-page": TextSearchIcon,
  "action:copy-prompt-link": LinkIcon,
  "action:copy-prompt-link-with-context": LinkIcon,
  "action:copy-thread-reference": LinkIcon,
  "action:link-pull-request": PullRequestGlyph.link,
  "action:open-thread-pull-requests": PullRequestGlyph.link,
  "action:pull-requests": PullRequestGlyph.pullRequest,
  "action:share-thread-with-guest": UserPlusIcon,
  "action:restart-agent-session": RotateCcwIcon,
  "action:open-file-picker": FileSearchIcon,
  "action:search-project-contents": TextSearchIcon,
  "action:new-project": FolderGit2Icon,
  "action:use-in-another-app": PlugIcon,
  "action:usage": ChartColumnBigIcon,
  "action:settings": SettingsIcon,
  "action:shuffle-theme": ShuffleIcon,
  "action:change-theme": PaletteIcon,
  "action:change-appearance": MonitorIcon,
  "action:theme-editor": PaletteIcon,
};

/** A random built-in theme, never the one in use. */
export function shuffleTheme(currentTheme: string) {
  const choices = MINE_THEMES.filter((candidate) => candidate.id !== currentTheme);
  const next = choices[Math.floor(Math.random() * choices.length)];
  if (next === undefined || setTheme(next.id)) return;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn’t save theme selection",
      description: "Try again.",
    }),
  );
}

const selectPinned = (settings: { readonly pinnedQuickActions: readonly PinnedQuickAction[] }) =>
  settings.pinnedQuickActions;

export function useQuickActionPin() {
  const pinned = useClientSettings(selectPinned);
  return (value: string, title: string): CommandPaletteItemPin => {
    const isPinned = pinned.some((action) => action.value === value);
    return {
      name: title,
      pinned: isPinned,
      toggle: () =>
        void updateClientSettings({
          pinnedQuickActions: isPinned
            ? pinned.filter((action) => action.value !== value)
            : [{ value, title }, ...pinned],
        }),
    };
  };
}

/**
 * Whether the palette offers a pinned row on this screen. Mirrors the palette's own checks for
 * its conditional rows, so a pin is greyed out instead of opening the palette to say "isn't
 * available on this screen". Keep in step with the action list in CommandPalette.tsx.
 */
function useQuickActionAvailable() {
  const routeTarget = useThreadRouteTarget();
  const threadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const thread = useQuietThreadShell(threadRef);
  const draft = useComposerDraftStore((store) =>
    routeTarget === null
      ? null
      : routeTarget.kind === "server"
        ? store.getDraftThread(routeTarget.threadRef)
        : store.getDraftSession(routeTarget.draftId),
  );
  const promptTarget =
    routeTarget === null
      ? null
      : routeTarget.kind === "server"
        ? routeTarget.threadRef
        : routeTarget.draftId;
  const hasPromptLink = useComposerDraftStore((store) => {
    const composer = promptTarget === null ? null : store.getComposerDraft(promptTarget);
    return composer ? promptLinkFor(composer.prompt) !== null : false;
  });
  const projectRef = thread ?? draft;
  const project = useProjects().find(
    (candidate) =>
      candidate.environmentId === projectRef?.environmentId &&
      candidate.id === projectRef.projectId,
  );
  const { environments } = useEnvironments();
  const environmentId = thread?.environmentId ?? ("" as EnvironmentId);
  const serverConfig = useServerConfigs().get(environmentId);
  const canShare = useAtomValue(canShareWithGuestAtom(environmentId));
  const panelRef = thread
    ? scopeThreadRef(thread.environmentId, thread.id)
    : draft
      ? scopeThreadRef(draft.environmentId, draft.threadId)
      : null;
  const previewOpen = useRightPanelStore(
    (state) => selectActiveRightPanel(state.byThreadKey, panelRef) === "preview",
  );
  const onPullRequests = useLocation({
    select: (location) => location.pathname === "/pull-requests",
  });
  const openPullRequestUrl = useOpenPanelPullRequestUrl(
    onPullRequests ? PULL_REQUESTS_PANEL_REF : null,
  );
  const anyServer = environments.some((environment) => environment.serverConfig !== null);
  const linksPullRequests =
    thread !== null &&
    threadPullRequestLinkMode(serverConfig?.environment.capabilities) !== "unsupported";

  return (value: string): boolean => {
    switch (value) {
      case "find-current-thread":
        return (
          thread !== null &&
          environments.find((environment) => environment.environmentId === thread.environmentId)
            ?.serverConfig?.threadFind === true
        );
      case "find-in-browser-page":
        return previewOpen && Boolean(previewBridge);
      case "action:copy-prompt-link":
        return hasPromptLink;
      case "action:copy-prompt-link-with-context":
        return hasPromptLink && promptLinkRepositoryOf(project) !== null;
      // "Copy thread" becomes "Copy PR link" on the Pull requests page.
      case "action:copy-thread-reference":
        return onPullRequests ? anyServer && Boolean(openPullRequestUrl) : thread !== null;
      case "action:link-pull-request":
        return linksPullRequests;
      case "action:open-thread-pull-requests":
        return linksPullRequests && visibleThreadPullRequests(thread.pullRequests).length > 0;
      case "action:share-thread-with-guest":
        return thread !== null && canShare;
      case "action:restart-agent-session":
        return thread !== null;
      case "action:pull-requests":
        return anyServer;
      default:
        return true;
    }
  };
}

export function usePinnedQuickActions() {
  const available = useQuickActionAvailable();
  const pinned = useClientSettings(selectPinned);
  const actions = pinned.map((action) => ({
    ...action,
    Icon: ICONS[action.value] ?? PinIcon,
    available: available(action.value),
    run: () => runCommandPaletteItem(action.value, action.title),
  }));
  const unpin = (value: string) =>
    void updateClientSettings({
      pinnedQuickActions: pinned.filter((action) => action.value !== value),
    });
  const move = (value: string, toIndex: number) => {
    const from = pinned.findIndex((action) => action.value === value);
    const moved = pinned[from];
    if (moved === undefined || toIndex < 0 || toIndex >= pinned.length || toIndex === from) return;
    const next = pinned.filter((action) => action.value !== value);
    next.splice(toIndex, 0, moved);
    void updateClientSettings({ pinnedQuickActions: next });
  };
  return { actions, unpin, move };
}

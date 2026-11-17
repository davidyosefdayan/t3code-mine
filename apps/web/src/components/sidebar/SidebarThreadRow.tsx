import { useAtomMount, useAtomValue } from "@effect/atom-react";
import { asLaunchingThread } from "@t3tools/client-runtime/state/thread-inbox";
import { useThreadIsWorking } from "../../state/threadWorking";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import {
  activeSurfaceClassName,
  restSurfaceClassName,
  selectedSurfaceClassName,
  SidebarThreadCardBody,
  ThreadRowHoverActions,
  rowContentClassName,
  ThreadRowMetaLine,
  ThreadRowSecondLine,
} from "./ThreadRowParts";
import { isYourTurnUnseen, threadWaitingOnYou, yourTurnSince } from "../needsYouCount";
import { resolveThreadRowLine } from "./threadGroups";
import { ReadAloudThreadIndicator } from "./ReadAloudThreadIndicator";
import {
  ThreadTerminalStatusButton,
  prStatusIndicator,
  resolveThreadPullRequestBadge,
  resolveThreadPullRequestBadgePresentation,
  useLinkedThreadPullRequest,
} from "../ThreadStatusIndicators";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/client-runtime/thread-pull-requests";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { discardComposerDraft } from "../../lib/discardComposerDraft";
import { contextMenuSourceOf } from "../../contextMenuSource";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { useDeadlinePassed } from "~/hooks/useDeadline";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
} from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveSettledThreadTimestamp,
  resolveThreadActivityTimestamp,
} from "@t3tools/client-runtime/state/thread-sort";
import { type EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { toServerClock } from "@t3tools/client-runtime/clock";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuSource,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  AlarmClockOffIcon,
  CircleCheckIcon,
  ClockIcon,
  PinIcon,
  PinOffIcon,
  Undo2Icon,
} from "lucide-react";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { msg, T, useGT, useMessages } from "gt-react";

import type { MessageResolver } from "../../i18n/messages";

import { useUiStateStore } from "../../uiStateStore";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useNowSecond } from "../../hooks/useNowSecond";
import { vcsEnvironment, vcsBranchRevalidation } from "../../state/vcs";
import { useSidebarLinkedIssueState } from "../../state/issues";
import { IssueGlyph, issueStatePresentation } from "../issue/issuePresentation";
import { useRightPanelStore } from "../../rightPanelStore";
import { ActivityShimmerOverlay } from "../chat/TimelineRowParts";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import {
  readEnvironmentScope,
  useEnvironmentScope,
  useEnvironmentScopeDenied,
} from "../../state/session";
import { formatRelativeTime, parseTimestampDate } from "../../timestampFormat";
import type { SidebarThreadSummary } from "../../types";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import {
  animateSidebarLayoutChanges,
  resolveSidebarRowAccessibility,
  type SidebarDropVerb,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
  resolveWorkingStartedAt,
  useRetainedValue,
  withoutRemovedCheckout,
  useSidebarRowSubscriptionLease,
  setFileDragActive,
} from "../Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "../BranchToolbar.logic";
import {
  terminalStatusFromRunningIds,
  type TerminalStatusIndicator,
  ThreadSearchPullRequestNumber,
} from "../ThreadStatusIndicators";
import { pickSnoozePreset, resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { useThreadShell } from "../../state/entities";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { ThreadSearchMatchExcerpt } from "../ThreadSearchMatch";
import { makeWorkspaceFileDropHandlers } from "../chat/workspaceFileDrop";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { useThreadRunningTerminalIds } from "../../state/terminalSessions";
import { Kbd } from "../ui/kbd";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useThreadIntentPrefetch } from "./useThreadIntentPrefetch";
import { InlineButton } from "../ui/button";
import { useThreadDraftPrompt, useThreadHasUnsentDraft } from "../../composerDraftStore";

// The fields thread rows show. Provider status pushes refresh `checkedAt`,
// status and auth on every provider; leaving those out keeps each
// environment's map, and every memoized row, stable across them.
export type SidebarProviderEntry = Pick<
  ProviderInstanceEntry,
  | "instanceId"
  | "driverKind"
  | "enabled"
  | "displayName"
  | "accentColor"
  | "acpRegistryAgentId"
  | "acpRegistryIconUrl"
  | "models"
>;
function compactSidebarTimeLabel(timestamp: string, nowMs: number, resolve: MessageResolver) {
  const parts = formatRelativeTime(timestamp, nowMs, resolve);
  if (parts === null) return "";
  return parts.suffix === null ? resolve(msg("now", { $context: "relative time" })) : parts.value;
}

function PendingSyncLabel() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <T>Pending</T>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>Waiting to sync with its environment</T>
      </TooltipPopup>
    </Tooltip>
  );
}

// Subscribes to the minute tick itself, so only the label re-renders each
// minute. The minute is passed as the clock so it is the formatter's input.
function RelativeTimeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  const m = useMessages();
  return props.timestamp === null
    ? null
    : compactSidebarTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`), m);
}

export function JumpHintBadge(props: { label: string }) {
  return (
    <Kbd aria-hidden data-jump-hint>
      {props.label}
    </Kbd>
  );
}

export const JUMP_HINT_SLOT_CLASS_NAME =
  "[&>:not([data-jump-hint])]:invisible [&>:not([data-jump-hint])]:absolute";

function WorkingDuration(props: { environmentId: EnvironmentId; startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  if (Number.isNaN(startedMs)) return null;
  return <WorkingDurationLabel environmentId={props.environmentId} startedMs={startedMs} />;
}

// Self-ticking so only this span re-renders each second, not the whole row;
// the shared tick lands every working row's update in the same frame.
function WorkingDurationLabel(props: { environmentId: EnvironmentId; startedMs: number }) {
  const nowMs = useNowSecond();
  const messages = useMessages();
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(
        toServerClock(props.environmentId, nowMs) - props.startedMs,
        messages,
      )}
    </span>
  );
}

function terminalProcessLabel(count: number, resolve: MessageResolver): string {
  return resolve(
    msg(
      "{count, plural, one {{count} terminal process running} other {{count} terminal processes running}}",
      { count },
    ),
  );
}

function SidebarThreadTooltip({
  thread,
  project,
  projectDisplayName,
  environmentLabel,
  environmentMachine,
  providerEntry,
  providerEntryByInstanceId,
  showInstanceBadge,
  modelInstanceId,
  modelLabel,
  branchMismatch,
  terminalStatus,
  terminalProcessCount,
  onOpenPullRequest,
  onOpenIssue,
}: {
  thread: SidebarThreadSummary;
  project: ProjectFaviconProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntry: SidebarProviderEntry | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  showInstanceBadge: boolean;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
  terminalStatus: TerminalStatusIndicator | null;
  terminalProcessCount: number;
  onOpenPullRequest?: (event: ReactMouseEvent<HTMLAnchorElement>, url: string) => void;
  onOpenIssue?: () => void;
}) {
  const previousProviderNames = thread.providerInstanceHistory
    .filter((instanceId) => instanceId !== modelInstanceId)
    .map((instanceId) => providerEntryByInstanceId.get(instanceId)?.displayName ?? instanceId);
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const m = useMessages();
  return (
    // Personal build: the card takes the pointer, so it stays open to click a PR in it.
    <ThreadHoverCardPopup side="right" align="start" sideOffset={4} className="pointer-events-auto">
      <SidebarThreadCardBody
        thread={thread}
        project={project}
        projectDisplayName={projectDisplayName}
        environmentLabel={environmentLabel}
        environmentMachine={environmentMachine}
        providerEntry={providerEntry}
        showInstanceBadge={showInstanceBadge}
        modelInstanceId={modelInstanceId}
        modelLabel={modelLabel}
        previousProviderNames={previousProviderNames}
        branchMismatch={branchMismatch}
        terminalStatus={terminalStatus}
        terminalProcessLabel={terminalProcessLabel(terminalProcessCount, m)}
        showPullRequests={supportsMultiplePullRequests}
        {...(onOpenPullRequest ? { onOpenPullRequest } : {})}
        {...(onOpenIssue ? { onOpenIssue } : {})}
      />
    </ThreadHoverCardPopup>
  );
}

function SnoozeMenuButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  timestampFormat: TimestampFormat;
  environmentId: EnvironmentId;
}) {
  const { open, onOpenChange, onSnooze, timestampFormat, environmentId } = props;
  const gt = useGT();
  const messages = useMessages();
  const presets = open
    ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
      resolveSnoozePresets(new Date(), timestampFormat, environmentId, messages)
    : [];
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Snooze thread")}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="inline-flex h-full cursor-pointer items-center gap-0.5 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                />
              }
            />
          }
        >
          <ClockIcon className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Snooze thread</T>
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="bottom" align="end">
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={(event) => {
              event.stopPropagation();
              const picked = pickSnoozePreset(presets, preset.id, timestampFormat, environmentId);
              if (picked) onSnooze(picked);
            }}
          >
            {preset.label}
            <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
          </MenuItem>
        ))}
        {presets.length > 0 ? <MenuSeparator /> : null}
        <MenuItem
          onClick={async (event) => {
            event.stopPropagation();
            const choice = await requestCustomSnooze();
            if (choice) onSnooze(choice);
          }}
        >
          <T>Custom…</T>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

type SortableThreadRowBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

export const draftSurfaceClassName = "bg-warning/4 hover:bg-warning/8";
export const draftPenClassName = "size-3 shrink-0 text-warning-foreground";

// useSortable memoizes on its `disabled` object, so a fresh one per render
// re-renders every row and marker on each sidebar update.
export const SIDEBAR_SORTABLE_DRAG_DISABLED = { draggable: true } as const;
const SIDEBAR_SORTABLE_DRAG_ENABLED = { draggable: false } as const;

// Takes the row's props rather than a render function: a closure from the
// sidebar body is new on every sidebar render, which rebuilt the bag and
// re-rendered every memoized row with it.
export function SortableThreadRow(
  props: Omit<SidebarThreadRowProps, "sortable"> & {
    sortableId: string;
    sortableDisabled: boolean;
    contextDrag: boolean;
  },
) {
  const { sortableId, sortableDisabled, contextDrag, ...rowProps } = props;
  const canOperateThread = useEnvironmentScope(
    rowProps.thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    disabled:
      sortableDisabled || !canOperateThread
        ? SIDEBAR_SORTABLE_DRAG_DISABLED
        : SIDEBAR_SORTABLE_DRAG_ENABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // dnd-kit memoizes each field but not the bag, so the memoized row would
  // rerender on every shell update without this.
  const bag = {
    listeners,
    setNodeRef,
    transform: contextDrag ? null : transform,
    transition: contextDrag && isDragging ? "transform 150ms ease-out" : transition,
    isDragging: isDragging && !contextDrag,
  };
  // The sidebar arranges rows from quiet shells, which hold still while a
  // thread streams; reading the live shell here re-renders only this row.
  const liveThread = useThreadShell(
    scopeThreadRef(rowProps.thread.environmentId, rowProps.thread.id),
  );
  // A runtime on the arranged copy but not the run-less live shell is the list's launch overlay.
  const thread =
    liveThread === null
      ? rowProps.thread
      : rowProps.thread.runtime !== null
        ? asLaunchingThread(liveThread)
        : liveThread;
  // Keyed by variant so a card/slim switch remounts the row.
  return <SidebarThreadRow key={rowProps.variant} {...rowProps} thread={thread} sortable={bag} />;
}
// Personal build: upstream's drag-to-sweep across row buttons is left out;
// each row's button acts on that row alone.
export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";
const dropVerbBadge: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon aria-hidden className="size-3" />
      <T>Pin</T>
    </>
  ),
  unpin: (
    <>
      <PinOffIcon aria-hidden className="size-3" />
      <T>Unpin</T>
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon aria-hidden className="size-3" />
      <T>Settle</T>
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon aria-hidden className="size-3" />
      <T>Un-settle</T>
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon aria-hidden className="size-3" />
      <T>Wake</T>
    </>
  ),
};

type SidebarThreadRowProps = {
  thread: SidebarThreadSummary;
  // Personal build: every chat, in every section, is the same card. The folder
  // variants belong to upstream's boring sidebar (Labs, hidden here).
  variant: "card" | "folder" | "folder-multiline";
  navigationParent?: string | undefined;
  // Personal build: Working rows step back until hovered or open.
  quiet?: boolean | undefined;
  variantAction: SidebarSweepAction;
  settlementSupported: boolean;
  snoozeSupported: boolean;
  pinningSupported: boolean;
  isPinned: boolean;
  sortable?: SortableThreadRowBag | undefined;
  dropVerb: SidebarDropVerb | null;
  dragOverPinned: boolean;
  snoozeWakeLabelText: string | null;
  wokeAt: string | null;
  isActive: boolean;
  // Set on the active row only; scrolls it into view when a reveal is owed.
  revealRef?: ((row: HTMLElement, threadKey: string) => (() => void) | undefined) | undefined;
  // Unlike isActive, never true for the ancestor standing in for an open
  // subagent: drafts and PR clicks care about which composer is on screen.
  isRouteThread: boolean;
  // Read at click time; a prop would re-render every row on entering or leaving a thread route.
  readOpensPullRequestsInRightPanel: () => boolean;
  jumpLabel: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  timestampFormat: TimestampFormat;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  onSettle: (threadRef: ScopedThreadRef) => void;
  onUnsettle: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: Pick<SnoozePreset, "snoozedUntil">) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onUnpin: (threadRef: ScopedThreadRef) => void;
  onAcknowledgeWoke: (threadRef: ScopedThreadRef, visitedAt: string) => void;
  onMarkUnread: (threadRef: ScopedThreadRef) => void;
  onClearWaitingOnYou: (threadRef: ScopedThreadRef) => void;
  onFileDropThreads?: ((threadRef: ScopedThreadRef, files: File[]) => void) | undefined;
};

// Mounted only while renaming, so each rename starts uncommitted.
function ThreadRenameInput(props: {
  title: string;
  onTitleChange: (title: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const gt = useGT();
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={props.title}
      dir="auto"
      aria-label={gt("Thread title")}
      onChange={(event) => props.onTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onCommit();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="-mx-1 min-w-0 flex-1 rounded-sm bg-card px-1 text-sm font-medium text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}

const SidebarThreadRow = memo(function SidebarThreadRow(props: SidebarThreadRowProps) {
  const gt = useGT();
  const messages = useMessages();
  const {
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onAcknowledgeWoke,
    onFileDropThreads,
    onMarkUnread,
    onClearWaitingOnYou,
    onRenameTitleChange,
    onSettle,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsettle,
    onUnsnooze,
    onUnpin,
    renamingTitle,
    thread,
    variantAction,
  } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const canTriageThread = !useEnvironmentScopeDenied(
    thread.environmentId,
    AuthOrchestrationOperateScope,
  );
  const pendingSync = useAtomValue(
    threadEnvironment.pendingSyncAtom(thread.environmentId),
    (threads) => threads.has(thread.id),
  );
  const { leaseLiveStatus, rowRef: leaseRowRef } = useSidebarRowSubscriptionLease(props.isActive);
  const { revealRef } = props;
  const rowRef = (row: HTMLElement | null) => {
    const stopReveal = row === null ? undefined : revealRef?.(row, threadKey);
    const releaseLease = leaseRowRef(row);
    if (!stopReveal) return releaseLease;
    return () => {
      stopReveal();
      releaseLease?.();
    };
  };
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds, messages);
  const terminalProcessCount = runningTerminalIds.length;
  const hasUnsentDraft = useThreadHasUnsentDraft(threadRef) && !props.isRouteThread;
  // Personal build: like a messages app, a chat with unsent text previews
  // what you typed ("Draft: …") instead of the agent's last reply.
  const draftPrompt = useThreadDraftPrompt(threadRef);
  const handleDiscardDraftClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    discardComposerDraft(threadRef);
  };

  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const branchTarget =
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? { environmentId: thread.environmentId, cwd: gitCwd }
      : null;
  const gitStatus = useEnvironmentQuery(
    branchTarget === null
      ? null
      : vcsEnvironment.branch({
          environmentId: branchTarget.environmentId,
          input: { cwd: branchTarget.cwd },
        }),
  );
  useAtomMount(vcsBranchRevalidation(branchTarget));
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const checkoutThread = withoutRemovedCheckout(thread, visibleGitStatus, props.project);
  // Personal build: upstream's pull request badge, on the row's bottom line
  // beside the model logo. Several PRs collapse into one count or stack badge.
  // It only shows; the hover card lists the PRs to open (one place, not two).
  const linkedPullRequestStatus = useLinkedThreadPullRequest(
    thread.environmentId,
    thread.linkedPullRequest,
    leaseLiveStatus,
    thread.pullRequests,
    thread.branchPullRequest,
  );
  const pr = linkedPullRequestStatus?.pr ?? null;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(thread.environmentId);
  const currentLinkedPr = supportsMultiplePullRequests
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests)
    : null;
  const prStatus = prStatusIndicator(pr, linkedPullRequestStatus?.sourceControlProvider, messages);
  const openPrLink = useOpenPrLink();
  const handlePrClick = (event: ReactMouseEvent<HTMLAnchorElement>, targetUrl?: string) => {
    const url = targetUrl ?? pr?.url ?? currentLinkedPr?.url;
    if (!url) return;
    const showInRightPanel = targetUrl !== undefined || props.readOpensPullRequestsInRightPanel();
    const openedInRightPanel = openPrLink(event, url, showInRightPanel ? threadRef : undefined);
    if (openedInRightPanel && showInRightPanel && !props.isRouteThread) {
      onThreadActivate(threadRef);
    }
  };
  const prBadgeShape = supportsMultiplePullRequests
    ? resolveThreadPullRequestBadge(thread.pullRequests)
    : null;
  const prPresentation = resolveThreadPullRequestBadgePresentation({
    badge: prBadgeShape,
    number: pr?.number ?? currentLinkedPr?.number,
    url: pr?.url ?? currentLinkedPr?.url,
    status: prStatus,
  });
  const prBadge = prPresentation ? (
    <span
      aria-label={prPresentation.label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 tabular-nums",
        prPresentation.toneClassName,
      )}
    >
      <prPresentation.Icon aria-hidden className="size-3 shrink-0 text-current" />
      <span>{prPresentation.text}</span>
    </span>
  ) : null;
  // Personal build: upstream's linked-issue badge, shown like the PR badge.
  const firstIssue = thread.issues?.[0];
  const issueCount = thread.issues?.length ?? 0;
  const issueState = useSidebarLinkedIssueState(
    thread.environmentId,
    leaseLiveStatus ? thread.issues : undefined,
  );
  const issueStatus = issueState === null ? null : issueStatePresentation(issueState);
  const IssueIcon = issueStatus?.Icon ?? IssueGlyph.issue;
  const openLinkedItems = () => {
    useRightPanelStore.getState().open(threadRef, "pull-requests");
    if (!props.isRouteThread) onThreadActivate(threadRef);
  };
  const issueLabel =
    issueCount === 1 && firstIssue
      ? issueStatus
        ? gt("Issue {key}: {title}, {state}", {
            key: firstIssue.displayKey,
            title: firstIssue.title,
            state: issueStatus.label,
          })
        : gt("Issue {key}: {title}", { key: firstIssue.displayKey, title: firstIssue.title })
      : gt("{count, plural, one {{count} linked issue} other {{count} linked issues}}", {
          count: issueCount,
        });
  // Personal build: the linked issues list in the row's hover card, beside its pull requests.
  const issueBadge = firstIssue ? (
    <InlineButton
      tone="muted"
      aria-label={issueLabel}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openLinkedItems();
      }}
    >
      <IssueIcon aria-hidden className={cn("size-3 shrink-0", issueStatus?.toneClassName)} />
      <span className="max-w-16 truncate text-xs font-normal tabular-nums">
        {issueCount === 1 ? firstIssue.displayKey : issueCount}
      </span>
    </InlineButton>
  ) : null;

  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  const isWorking = useThreadIsWorking();
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke =
    wokeAtDate !== null &&
    (lastVisitedDate === null || lastVisitedDate < wokeAtDate) &&
    thread.settledOverride !== "settled";
  // Personal build: unread covers a finished turn, an approval, question, or
  // failure you haven't looked at, and a woken snooze. A chat still in Working
  // isn't unread yet (the shared tracker, see state/threadWorking). Reading clears it.
  const showsAsUnread = !isWorking(thread) && (isWoke || isYourTurnUnseen(thread, lastVisitedAt));
  const canToggleRead = yourTurnSince(thread) !== null || isWoke;
  const handleToggleReadClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Reading records a visit now, which also clears a woken snooze.
    if (showsAsUnread) onAcknowledgeWoke(threadRef, new Date().toISOString());
    else onMarkUnread(threadRef);
  };
  const topStatus =
    status === "preparing" || status === "working"
      ? {
          label:
            status === "preparing"
              ? gt("Setting up")
              : thread.goal?.status === "active"
                ? gt("Goal", { $context: "thread status: working on a goal" })
                : gt("Working", { $context: "thread status" }),
          icon: "working" as const,
          className: "text-info-foreground",
        }
      : status === "waiting"
        ? {
            label: gt("Waiting", { $context: "thread status" }),
            icon: "waiting" as const,
            className: "text-info-foreground",
          }
        : status === "approval"
          ? {
              label: gt("Approval", { $context: "thread status: needs approval" }),
              icon: "approval" as const,
              className: "text-warning-foreground",
            }
          : status === "input"
            ? {
                label: gt("Input", { $context: "thread status: needs user input" }),
                icon: "input" as const,
                className: "text-warning-foreground",
              }
            : status === "request"
              ? {
                  label: gt("Request", { $context: "thread status: guest request" }),
                  icon: "request" as const,
                  className: "text-guest-foreground",
                }
              : status === "limited"
                ? {
                    label: gt("Limited", { $context: "thread status: usage limited" }),
                    icon: "failed" as const,
                    className: "text-warning-foreground",
                  }
                : status === "failed"
                  ? {
                      label: gt("Failed", { $context: "thread status" }),
                      icon: "failed" as const,
                      className: "text-error-foreground",
                    }
                  : isWoke
                    ? {
                        label: gt("Woke", { $context: "thread status: woke from snooze" }),
                        icon: "woke" as const,
                        className: "text-warning-foreground",
                      }
                    : null;

  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });

  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelName(selectedModel, providerEntry?.driverKind)
    : thread.modelSelection.model;

  const detailsTooltip = (
    <SidebarThreadTooltip
      thread={checkoutThread}
      project={props.project}
      projectDisplayName={props.projectDisplayName}
      environmentLabel={props.environmentLabel}
      environmentMachine={props.environmentMachine}
      providerEntry={providerEntry}
      providerEntryByInstanceId={props.providerEntryByInstanceId}
      showInstanceBadge={showInstanceBadge}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
      terminalStatus={terminalStatus}
      terminalProcessCount={terminalProcessCount}
      onOpenPullRequest={handlePrClick}
      onOpenIssue={() => {
        if (!props.isRouteThread) onThreadActivate(threadRef);
      }}
    />
  );

  const intentPrefetch = useThreadIntentPrefetch(threadRef);
  const handleClick = (event: ReactMouseEvent) => {
    onThreadClick(event, threadRef);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    onContextMenu(threadRef, { x: event.clientX, y: event.clientY }, contextMenuSourceOf(event));
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (
      event.key === "F2" &&
      !isRenaming &&
      readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
    ) {
      event.preventDefault();
      onStartRename(threadRef, thread.title);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onThreadActivate(threadRef);
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (
      !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope) ||
      isRenaming ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    onStartRename(threadRef, thread.title);
  };
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const fileDropHandlers = onFileDropThreads
    ? makeWorkspaceFileDropHandlers({
        setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
        addFiles: (files) => {
          onFileDropThreads(threadRef, files);
        },
        addFolders: () => {},
      })
    : null;
  const handleSettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSettle(threadRef);
  };
  const handleUnsettleClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsettle(threadRef);
  };
  const handleUnsnoozeClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnsnooze(threadRef);
  };
  const handleClearWaitingOnYouClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onClearWaitingOnYou(threadRef);
  };
  const handleUnpinClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onUnpin(threadRef);
  };
  const handleSnoozePreset = (preset: Pick<SnoozePreset, "snoozedUntil">) => {
    onSnooze(threadRef, preset);
  };
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // The React Compiler caches render results on their inputs, so a clock read
  // here would stay frozen until `thread` changes and a queued-turn gate would
  // never reopen. The gate's clock is state, reset with the thread.
  const [snoozeGateClock, setSnoozeGateClock] = useState(() => ({
    thread,
    now: new Date().toISOString(),
  }));
  if (snoozeGateClock.thread !== thread) {
    // oxlint-disable-next-line react/purity -- Reseeds the snooze gate clock only in the render-phase adjustment that runs when the thread changes.
    setSnoozeGateClock({ thread, now: new Date().toISOString() });
  }
  const snoozeGateNow = snoozeGateClock.now;
  const snoozeGateExpiryMs = hasQueuedTurnStart(thread, { now: snoozeGateNow })
    ? Date.parse(thread.latestUserMessageAt ?? "") + QUEUED_TURN_START_GRACE_MS
    : Number.NaN;
  // A gate still closed past its expiry is held by runtime status, not time,
  // so no clock tick can open it.
  const snoozeGateOpensAt =
    Number.isFinite(snoozeGateExpiryMs) && snoozeGateExpiryMs > Date.parse(snoozeGateNow)
      ? snoozeGateExpiryMs + 50
      : null;
  const snoozeGateOpened = useDeadlinePassed(snoozeGateOpensAt);
  if (snoozeGateOpened && snoozeGateOpensAt !== null) {
    setSnoozeGateClock({ thread, now: new Date(snoozeGateOpensAt).toISOString() });
  }
  // Personal build: a pinned chat stays in view, so it unpins instead of
  // settling and can't be snoozed.
  const isPinnedRow = props.isPinned && props.pinningSupported;
  const showSnoozeButton =
    canTriageThread &&
    variantAction === "settle" &&
    !isPinnedRow &&
    props.snoozeSupported &&
    canSnooze(thread, { now: snoozeGateNow });
  // Closing here, not just masking, keeps the menu from reopening when the button returns.
  if (snoozeMenuOpenRaw && !showSnoozeButton) setSnoozeMenuOpen(false);
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  const jumpHintLabel = snoozeMenuOpen ? null : props.jumpLabel;

  // Personal build: bold means unread; the second line says what's waiting.
  // Working rows don't fade: they have their own group.
  const rowSurfaceClassName = cn(
    "group/sidebar-row relative w-full cursor-pointer overflow-hidden rounded-xl text-left text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    props.isActive
      ? activeSurfaceClassName
      : isSelected
        ? selectedSurfaceClassName
        : restSurfaceClassName,
    isFileDragOver && "ring-1 ring-inset ring-primary/70",
    isFileDragOver && !props.isActive && !isSelected && "bg-sidebar-row-hover",
    props.sortable?.isDragging &&
      "bg-sidebar bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground opacity-100 shadow-lg",
  );
  const sortable = props.sortable;
  const sortableRootProps = sortable
    ? {
        ref: sortable.setNodeRef,
        style: {
          transform: CSS.Translate.toString(sortable.transform),
          transition: sortable.transition,
          // A zero-height boundary also makes dnd-kit scale the source to
          // zero. Only projected peers use scaleY as a visibility sentinel.
          visibility:
            !sortable.isDragging && sortable.transform?.scaleY === 0
              ? ("hidden" as const)
              : undefined,
        },
        ...sortable.listeners,
      }
    : {};
  const destinationVerb = sortable?.isDragging ? props.dropVerb : null;
  const dragDestination =
    destinationVerb !== null ? (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 text-2xs font-medium text-primary"
      >
        {dropVerbBadge[destinationVerb]}
      </span>
    ) : null;

  const rowLine = resolveThreadRowLine({
    thread,
    status,
    topStatus,
    hasUnsentDraft,
    draftPrompt,
    // The bottom line names the project and branch; a chat without a project names its machine.
    fallback: [props.projectDisplayName ? null : props.environmentLabel],
  });
  // Personal build: one time per row. Snoozed chats show when they come back,
  // settled ones when they were settled, chats waiting on you since when,
  // working ones how long the agent has been at it, else the last activity.
  const waitingOnYouSince = threadWaitingOnYou(thread)?.since ?? null;
  const rowTime = pendingSync ? (
    <PendingSyncLabel />
  ) : variantAction === "unsnooze" && props.snoozeWakeLabelText !== null ? (
    props.snoozeWakeLabelText
  ) : variantAction === "unsettle" ? (
    <RelativeTimeLabel timestamp={resolveSettledThreadTimestamp(thread)} />
  ) : waitingOnYouSince !== null ? (
    <RelativeTimeLabel timestamp={waitingOnYouSince} />
  ) : status === "preparing" || status === "working" ? (
    <WorkingDuration
      environmentId={thread.environmentId}
      startedAt={resolveWorkingStartedAt(thread)}
    />
  ) : status === "waiting" ? (
    <WorkingDuration
      environmentId={thread.environmentId}
      startedAt={thread.latestRun?.completedAt ?? null}
    />
  ) : (
    <RelativeTimeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
  );

  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    // Personal build: a chat waiting on you says what for.
    statusLabel: pendingSync ? gt("Pending") : (rowLine.status?.label ?? topStatus?.label ?? null),
    projectDisplayName: props.projectDisplayName,
    isActive: props.isActive,
  });

  const title =
    isRenaming && canOperateThread ? (
      <ThreadRenameInput
        title={renamingTitle}
        onTitleChange={onRenameTitleChange}
        onCommit={() => onCommitRename(threadRef, renamingTitle)}
        onCancel={onCancelRename}
      />
    ) : (
      <span
        aria-hidden
        ref={isRegeneratingTitle ? observeVisibleAnimation : undefined}
        className={cn(
          "min-w-0 flex-1 truncate text-start text-sm transition-opacity motion-reduce:transition-none",
          // Personal build: like Slack and Gmail, only unread chats read bold.
          showsAsUnread ? "font-semibold" : "font-normal",
          isRegeneratingTitle ? "relative text-muted-foreground" : "text-sidebar-foreground",
        )}
        dir={textDirection(thread.title)}
      >
        {thread.title}
        {isRegeneratingTitle ? (
          <ActivityShimmerOverlay className="truncate">{thread.title}</ActivityShimmerOverlay>
        ) : null}
      </span>
    );
  const accessibleTitle = isRenaming ? null : <span className="sr-only">{thread.title}</span>;

  const terminalStatusIcon = (
    <ThreadTerminalStatusButton
      threadRef={threadRef}
      terminalIds={runningTerminalIds}
      onThreadActivate={onThreadActivate}
    />
  );
  const showHoverActions =
    canTriageThread &&
    (props.settlementSupported ||
      props.snoozeSupported ||
      showSnoozeButton ||
      hasUnsentDraft ||
      canToggleRead ||
      isPinnedRow ||
      thread.waitingOnYou != null);

  return (
    <li
      data-thread-item={threadKey}
      data-highlighted={props.isActive || isSelected || undefined}
      {...sortableRootProps}
      {...(fileDropHandlers ?? {})}
      // The hints are the rendered heights inside py-0.5. Revealing the open thread measures rows
      // that have not rendered yet, so a hint off by a pixel lands it a pixel short per row above.
      className={cn(
        // Matches the row's height. A larger placeholder makes every remounted
        // list collapse a few pixels per row.
        // Personal build: no gap between rows; hairlines in `index.css` separate them.
        "relative list-none [contain-intrinsic-size:auto_74px]",
        // content-visibility clips paint to the row's square box, which cut the
        // dragged card's shadow into specks at its rounded bottom corners.
        sortable?.isDragging ? "z-20" : "[content-visibility:auto]",
      )}
    >
      <Tooltip disabled={isRenaming || snoozeMenuOpen || sortable?.isDragging}>
        <TooltipTrigger
          render={
            <div
              ref={rowRef}
              role="button"
              tabIndex={0}
              data-sidebar-row={threadKey}
              data-sidebar-parent={props.navigationParent}
              aria-label={accessibility.label}
              aria-current={accessibility.current}
              data-testid="sidebar-row-card"
              aria-busy={isRegeneratingTitle || undefined}
              className={rowSurfaceClassName}
              onClick={handleClick}
              onPointerEnter={intentPrefetch.onPointerEnter}
              onPointerLeave={intentPrefetch.onPointerLeave}
              onPointerDown={intentPrefetch.onPointerDown}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          {accessibleTitle}
          {/* Personal build: three levels: bold title and time; the reply or
              status; gray details. */}
          <div
            className={cn(
              rowContentClassName,
              props.quiet &&
                !props.isActive &&
                !isSelected &&
                "opacity-60 group-hover/sidebar-row:opacity-100",
            )}
          >
            <div className="flex h-5 min-w-0 items-center gap-2">
              {title}
              {/* Personal build: shows while this chat is being read aloud. */}
              <ReadAloudThreadIndicator threadKey={threadKey} />
              {/* The visible state owns this slot's width: the time at rest,
                    actions on hover/keyboard focus or while the popover is
                    open. Keeping the hidden state out of flow lets the title
                    reclaim space without either state overlapping it. */}
              {sortable?.isDragging ? (
                dragDestination
              ) : (
                <span
                  className={cn(
                    "group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs",
                    jumpHintLabel && JUMP_HINT_SLOT_CLASS_NAME,
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0",
                      showHoverActions &&
                        "group-any-hover/sidebar-row:absolute group-any-hover/sidebar-row:right-0 group-any-hover/sidebar-row:opacity-0",
                      "flex items-center self-center justify-self-end tabular-nums text-secondary-label transition-opacity",
                      snoozeMenuOpen && "pointer-events-none absolute right-0 opacity-0",
                    )}
                  >
                    {/* Unread, like a messages app. */}
                    {showsAsUnread ? (
                      <span aria-hidden className="mr-1.5 size-2 rounded-full bg-primary" />
                    ) : null}
                    {rowTime}
                  </span>
                  {showHoverActions ? (
                    <ThreadRowHoverActions
                      variantAction={variantAction}
                      isPinnedRow={isPinnedRow}
                      hasUnsentDraft={hasUnsentDraft}
                      canToggleRead={canToggleRead}
                      isWaitingOnYou={thread.waitingOnYou != null}
                      showsAsUnread={showsAsUnread}
                      snoozeSupported={props.snoozeSupported}
                      settlementSupported={props.settlementSupported}
                      snoozeMenuOpen={snoozeMenuOpen}
                      snoozeButton={
                        showSnoozeButton ? (
                          <SnoozeMenuButton
                            open={snoozeMenuOpen}
                            onOpenChange={setSnoozeMenuOpen}
                            onSnooze={handleSnoozePreset}
                            timestampFormat={props.timestampFormat}
                            environmentId={thread.environmentId}
                          />
                        ) : null
                      }
                      onUnpin={handleUnpinClick}
                      onDiscardDraft={handleDiscardDraftClick}
                      onToggleRead={handleToggleReadClick}
                      onClearWaitingOnYou={handleClearWaitingOnYouClick}
                      onUnsnooze={handleUnsnoozeClick}
                      onUnsettle={handleUnsettleClick}
                      onSettle={handleSettleClick}
                    />
                  ) : null}
                  {jumpHintLabel ? <JumpHintBadge label={jumpHintLabel} /> : null}
                </span>
              )}
            </div>
            {isRegeneratingTitle ? (
              <span role="status" className="sr-only">
                <T>Regenerating title</T>
              </span>
            ) : null}
            {/* Pull requests live in the hover card, not on the row. */}
            {/* Personal build: a row without a reply preview keeps the line
                empty so rows match, except on the Settled shelf, where the
                server sends no previews and the blank line read as a gap. */}
            {variantAction === "unsettle" &&
            rowLine.status === null &&
            rowLine.details === "" &&
            terminalProcessCount === 0 ? null : (
              <ThreadRowSecondLine
                status={rowLine.status}
                details={rowLine.details}
                trailing={terminalStatusIcon}
              />
            )}
            <ThreadRowMetaLine
              thread={thread}
              project={props.project}
              projectDisplayName={props.projectDisplayName}
              providerEntryByInstanceId={props.providerEntryByInstanceId}
              pullRequestBadge={
                prBadge || issueBadge ? (
                  <>
                    {prBadge}
                    {issueBadge}
                  </>
                ) : null
              }
            />
          </div>
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

// Attached only to the highlighted result, so React calls it each time the
// highlight lands on a different row: a new query, late rows replacing the first
// result, or arrow keys moving past the scrolled edge.
const scrollHighlightedResultIntoView = (node: HTMLLIElement | null) => {
  node?.scrollIntoView({ block: "nearest" });
};

export const SidebarSearchResultRow = memo(function SidebarSearchResultRow(props: {
  isSettled: boolean;
  thread: SidebarThreadSummary;
  project: EnvironmentProject | null;
  projectDisplayName: string | null;
  environmentLabel: string | null;
  environmentMachine: EnvironmentMachineKind;
  providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  searchMatch: EnvironmentThreadSearchMatch | null;
  searchQuery: string;
  /** The query `searchMatch` was found for, which lags `searchQuery` while a search runs. */
  searchMatchQuery?: string;
  onHighlight: () => void;
  onSelect: () => void;
  onContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  onFileDropThreads: (threadRef: ScopedThreadRef, files: File[]) => void;
}) {
  const messages = useMessages();
  const thread =
    useThreadShell(scopeThreadRef(props.thread.environmentId, props.thread.id)) ?? props.thread;
  const accessibility = resolveSidebarRowAccessibility({
    title: thread.title,
    statusLabel: null,
    projectDisplayName: props.projectDisplayName,
    isActive: props.isRouteActive,
  });
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  // Results only drag out as chat context; the row keeps its own listbox attributes.
  const { listeners: dragListeners, setNodeRef: setDragNodeRef } = useDraggable({
    id: scopedThreadKey(threadRef),
  });
  const { leaseLiveStatus, rowRef: leaseRowRef } = useSidebarRowSubscriptionLease(
    props.isHighlighted || props.isRouteActive,
  );
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const rowRef = (row: HTMLElement | null) => {
    setDragNodeRef(row);
    return leaseRowRef(row);
  };
  const gitCwd = thread.worktreePath ?? props.project?.workspaceRoot ?? null;
  const branchTarget =
    leaseLiveStatus && (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? { environmentId: thread.environmentId, cwd: gitCwd }
      : null;
  const gitStatus = useEnvironmentQuery(
    branchTarget === null
      ? null
      : vcsEnvironment.branch({
          environmentId: branchTarget.environmentId,
          input: { cwd: branchTarget.cwd },
        }),
  );
  useAtomMount(vcsBranchRevalidation(branchTarget));
  const visibleGitStatus = useRetainedValue(
    JSON.stringify([thread.environmentId, gitCwd]),
    gitStatus.data,
  );
  const checkoutThread = withoutRemovedCheckout(thread, visibleGitStatus, props.project);
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: visibleGitStatus?.refName ?? null,
  });
  const modelInstanceId = thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const showInstanceBadge =
    providerEntry !== null &&
    shouldShowInstanceBadge(providerEntry, props.providerEntryByInstanceId.values());
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelName(selectedModel, providerEntry?.driverKind)
    : thread.modelSelection.model;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: thread.environmentId,
    threadId: thread.id,
  });
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds, messages);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const onFileDropThreads = props.onFileDropThreads;
  const fileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: (active) => setFileDragActive(setIsFileDragOver, active),
    addFiles: (files) => {
      onFileDropThreads(threadRef, files);
    },
    addFolders: () => {},
  });
  return (
    <li
      ref={props.isHighlighted ? scrollHighlightedResultIntoView : undefined}
      role="presentation"
      className="list-none"
      {...fileDropHandlers}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              ref={rowRef}
              id={props.resultId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={props.isHighlighted}
              aria-current={accessibility.current}
              aria-describedby={`${props.resultId}-pr`}
              aria-label={accessibility.label}
              {...dragListeners}
              onMouseMove={props.onHighlight}
              // Focus stays in the search box, as for Enter. A focused result would lose focus as
              // the results close, and its recovery scrolls the list away from the opened thread.
              // dnd-kit ignores a prevented press, so the drag listener runs first.
              onPointerDown={(event) => {
                dragListeners?.onPointerDown?.(event);
                event.preventDefault();
              }}
              onClick={props.onSelect}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(
                  threadRef,
                  { x: event.clientX, y: event.clientY },
                  contextMenuSourceOf(event),
                );
              }}
              className={cn(
                "group/sidebar-row group/v2-row flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1 text-left text-sm outline-none",
                props.isHighlighted || props.isRouteActive
                  ? "bg-sidebar-row-active text-sidebar-foreground"
                  : "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                isFileDragOver && "ring-1 ring-inset ring-primary/70",
                isFileDragOver && !props.isRouteActive && "bg-sidebar-row-hover",
              )}
            />
          }
        >
          {props.project ? (
            <ProjectFavicon
              project={props.project}
              className={cn(
                "size-4 shrink-0 transition-opacity",
                props.isSettled &&
                  !props.isRouteActive &&
                  !props.isHighlighted &&
                  "opacity-40 grayscale group-hover/sidebar-row:opacity-100 group-hover/sidebar-row:grayscale-0",
              )}
            />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                ref={isRegeneratingTitle ? observeVisibleAnimation : undefined}
                className={cn(
                  "min-w-0 flex-1 truncate",
                  props.isSettled ? "font-normal" : "font-medium",
                  isRegeneratingTitle
                    ? "relative text-muted-foreground"
                    : props.isSettled && !props.isHighlighted && !props.isRouteActive
                      ? "text-secondary-label/70 group-hover/sidebar-row:text-foreground"
                      : "text-foreground",
                )}
              >
                {thread.title}
                {isRegeneratingTitle ? (
                  <ActivityShimmerOverlay className="truncate">
                    {thread.title}
                  </ActivityShimmerOverlay>
                ) : null}
              </span>
              <span id={`${props.resultId}-pr`} className="contents">
                <ThreadSearchPullRequestNumber
                  thread={thread}
                  query={props.searchQuery}
                  enabled={leaseLiveStatus}
                  settled={props.isSettled}
                />
              </span>
              <span className="min-w-8 shrink-0 text-right text-xs text-muted-foreground/55 tabular-nums">
                <RelativeTimeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
              </span>
            </span>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                match={{
                  source: props.searchMatch.source,
                  snippet: props.searchMatch.snippet,
                  query: props.searchMatchQuery ?? props.searchQuery,
                }}
              />
            ) : null}
          </span>
        </TooltipTrigger>
        <SidebarThreadTooltip
          thread={checkoutThread}
          project={props.project}
          projectDisplayName={props.projectDisplayName}
          environmentLabel={props.environmentLabel}
          environmentMachine={props.environmentMachine}
          providerEntry={providerEntry}
          providerEntryByInstanceId={props.providerEntryByInstanceId}
          showInstanceBadge={showInstanceBadge}
          modelInstanceId={modelInstanceId}
          modelLabel={modelLabel}
          branchMismatch={branchMismatch}
          terminalStatus={terminalStatus}
          terminalProcessCount={runningTerminalIds.length}
        />
      </Tooltip>
    </li>
  );
});

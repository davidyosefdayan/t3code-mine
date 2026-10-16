// Personal build: the thread list's groups (Unread, Pinned, Open, Working,
// Snoozed, Settled) and what each row's second line says. Sidebar.tsx keeps
// upstream's partition and calls into these.
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { SidebarThreadSummary } from "../../types";
import { liveWorkLine } from "../liveWorkLine";
import { sidebarMessagePreview } from "../messagePreview";
import { isThreadUnread } from "../needsYouCount";
import {
  firstValidTimestampMs,
  isSidebarThreadWorking,
  resolveThreadLastVisitedAt,
  sortArrangedThreads,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import { getVisibleSidebarGroupThreads } from "../Sidebar.visibility";

/** Groups that collapse from their title. Snoozed and Settled keep upstream's
    own shelf toggles. */
export type SidebarGroupId = "drafts" | "unread" | "pinned" | "open" | "working";

const COLLAPSED_GROUPS_STORAGE_KEY = "t3code:sidebar-collapsed-groups";
const CollapsedGroupsSchema = Schema.Array(Schema.String);
const NO_COLLAPSED_GROUPS: readonly string[] = [];

export function useCollapsedSidebarGroups() {
  const [collapsed, setCollapsed] = useLocalStorage(
    COLLAPSED_GROUPS_STORAGE_KEY,
    NO_COLLAPSED_GROUPS,
    CollapsedGroupsSchema,
  );
  return {
    isCollapsed: (group: SidebarGroupId) => collapsed.includes(group),
    toggle: (group: SidebarGroupId) =>
      setCollapsed((current) =>
        current.includes(group) ? current.filter((id) => id !== group) : [...current, group],
      ),
  };
}

function threadKeyOf(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** A collapsed group keeps only the open chat's row, like upstream's shelves. */
export function visibleGroupThreads(
  threads: readonly EnvironmentThreadShell[],
  collapsed: boolean,
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  return getVisibleSidebarGroupThreads({
    threads,
    collapsed,
    routeThreadKey,
    threadKey: threadKeyOf,
  });
}

/** Pinned and Open are homes you arrange; Unread and Working are states. While
    a chat is in one it shows in that state's group, pinned or not, and
    afterwards it goes back to its spot at home. */
export function sidebarThreadState(
  thread: EnvironmentThreadShell,
  localLastVisitedAtByKey: Readonly<Record<string, string>>,
  now: string,
  isWorking: (thread: EnvironmentThreadShell) => boolean = isSidebarThreadWorking,
): "working" | "unread" | null {
  if (isWorking(thread)) return "working";
  const lastVisitedAt = resolveThreadLastVisitedAt(
    thread.lastVisitedAt,
    localLastVisitedAtByKey[threadKeyOf(thread)],
  );
  return isThreadUnread(thread, lastVisitedAt, now) ? "unread" : null;
}

// Homes keep your order, and anything that arrives without a drag (a new
// chat, a fresh pin, a restored chat) lands at the bottom.
export function sortPinnedHome<T extends EnvironmentThreadShell>(threads: readonly T[]): T[] {
  return sortArrangedThreads(
    threads,
    (thread) => thread.pinOrderKey,
    (thread) => thread.pinnedAt ?? thread.createdAt,
  );
}

export function sortOpenHome<T extends EnvironmentThreadShell>(threads: readonly T[]): T[] {
  return sortArrangedThreads(
    threads,
    (thread) => thread.activeOrderKey,
    (thread) => thread.unsettledAt ?? thread.createdAt,
  );
}

/** Unread is a queue, oldest at the top, by when each chat started waiting on
    you (it came back to the inbox, or its snooze woke). */
export function sortUnreadByArrival<T extends EnvironmentThreadShell>(
  threads: readonly T[],
  now: string,
  returnedAt: (thread: T) => number | undefined,
): T[] {
  return sortInboxThreadsByReturn(threads, (thread) => {
    const wokeAt = threadWokeAt(thread, { now });
    return Math.max(returnedAt(thread) ?? 0, wokeAt === null ? 0 : firstValidTimestampMs(wokeAt));
  }).toReversed();
}

/** By the last message you sent, newest at the bottom; finishing and waking
    again do not move a row. */
export function sortWorkingByLastSend<T extends EnvironmentThreadShell>(
  threads: readonly T[],
): T[] {
  return sortWorkingThreadsBySend(threads).toReversed();
}

interface RowStatus {
  readonly label: string;
  readonly icon: string;
  readonly className: string;
}

/** A row's gray second line: why the chat is here, in its status color, then
    the latest reply (like a messages app). Unsent text you're writing
    outranks the status: you're already answering it. Unread and Working say
    "done" and "working" through their groups, so neither repeats here. A
    failed chat says why, and while the agent works its last reply is stale,
    so the line says what it's doing now. */
export function resolveThreadRowLine(input: {
  readonly thread: SidebarThreadSummary;
  readonly status: SidebarThreadStatus;
  readonly topStatus: RowStatus | null;
  readonly hasUnsentDraft: boolean;
  readonly draftPrompt: string;
  readonly fallback: readonly (string | null | undefined)[];
}): { readonly status: RowStatus | null; readonly details: string } {
  const { thread, topStatus, hasUnsentDraft } = input;
  const lineStatus: RowStatus | null = hasUnsentDraft
    ? { label: "Draft", icon: "draft", className: "text-warning-foreground" }
    : topStatus?.icon === "done" || topStatus?.icon === "working" || topStatus === null
      ? null
      : {
          ...topStatus,
          label:
            topStatus.icon === "approval"
              ? "Asks for approval"
              : topStatus.icon === "input"
                ? "Needs your input"
                : topStatus.label,
        };
  const draftPreview = hasUnsentDraft
    ? sidebarMessagePreview(
        replaceComposerContextReferences(input.draftPrompt, (occurrence) => occurrence.label),
      )
    : null;
  const failurePreview =
    !hasUnsentDraft && lineStatus?.icon === "failed"
      ? sidebarMessagePreview(thread.runtime?.lastError)
      : null;
  const workingDetails = input.status === "working" ? liveWorkLine(thread) : null;
  const details =
    draftPreview ??
    failurePreview ??
    workingDetails ??
    sidebarMessagePreview(thread.latestVisibleMessage?.text) ??
    input.fallback.filter((part): part is string => Boolean(part)).join(" · ");
  return { status: lineStatus, details };
}

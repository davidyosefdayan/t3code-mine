// Personal build: the thread list's groups (Needs you, Pinned, Open,
// Working, Snoozed, Settled) and what each row's second line says. Sidebar.tsx
// keeps upstream's partition and calls into these.
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import type { SidebarThreadSummary } from "../../types";
import { liveWorkLine } from "../liveWorkLine";
import { sidebarMessagePreview } from "../messagePreview";
import { threadWaitingOnYou, WAITING_ON_YOU_LABELS } from "../needsYouCount";
import {
  isThreadWorking as isSidebarThreadWorking,
  sortWorkingThreadsBySend,
} from "@t3tools/client-runtime/state/thread-inbox";
import {
  firstValidTimestampMs,
  sortArrangedThreads,
  type SidebarThreadStatus,
} from "../Sidebar.logic";
import { getVisibleSidebarGroupThreads } from "../Sidebar.visibility";

/** Groups that collapse from their title. Snoozed and Settled keep upstream's
    own shelf toggles. */
export type SidebarGroupId = "drafts" | "waiting-on-you" | "pinned" | "open" | "working";

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

/** Pinned and Open are homes you arrange; Needs you and Working are
    states a chat joins and leaves, pinned or not. Needs you outranks
    Working, so a chat that needs you never hides under Working. Unread is a
    dot on the row, not a group. */
export function sidebarThreadState(
  thread: EnvironmentThreadShell,
  isWorking: (thread: EnvironmentThreadShell) => boolean = isSidebarThreadWorking,
): "waiting-on-you" | "working" | null {
  if (threadWaitingOnYou(thread) !== null) return "waiting-on-you";
  return isWorking(thread) ? "working" : null;
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

/** Needs you is a queue, oldest at the top, by when each chat started
    waiting. */
export function sortWaitingOnYouBySince<T extends EnvironmentThreadShell>(
  threads: readonly T[],
): T[] {
  return threads.toSorted(
    (left, right) =>
      firstValidTimestampMs(threadWaitingOnYou(left)?.since ?? null) -
      firstValidTimestampMs(threadWaitingOnYou(right)?.since ?? null),
  );
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

/** A row's gray second line: its status in color, then the latest reply.
    Unsent text outranks the status. A chat waiting on you says what for, in
    the agent's words; a failed chat says why; a working one says what it's
    doing now, since its last reply is stale. */
export function resolveThreadRowLine(input: {
  readonly thread: SidebarThreadSummary;
  readonly status: SidebarThreadStatus;
  readonly topStatus: RowStatus | null;
  readonly hasUnsentDraft: boolean;
  readonly draftPrompt: string;
  readonly fallback: readonly (string | null | undefined)[];
}): { readonly status: RowStatus | null; readonly details: string } {
  const { thread, topStatus, hasUnsentDraft } = input;
  // Approvals, questions, and guest requests keep their own labels below.
  const agentWaiting = thread.waitingOnYou ?? null;
  const lineStatus: RowStatus | null = hasUnsentDraft
    ? { label: "Draft", icon: "draft", className: "text-warning-foreground" }
    : topStatus?.icon === "approval" ||
        topStatus?.icon === "input" ||
        topStatus?.icon === "request" ||
        agentWaiting === null
      ? topStatus?.icon === "done" || topStatus?.icon === "working" || topStatus === null
        ? null
        : {
            ...topStatus,
            label:
              topStatus.icon === "approval"
                ? "Asks for approval"
                : topStatus.icon === "input"
                  ? "Needs your input"
                  : topStatus.label,
          }
      : {
          label: WAITING_ON_YOU_LABELS[agentWaiting.kind],
          icon: "waiting-on-you",
          className: "text-warning-foreground",
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
    (lineStatus?.icon === "waiting-on-you" ? agentWaiting?.reason : null) ??
    failurePreview ??
    workingDetails ??
    sidebarMessagePreview(thread.latestVisibleMessage?.text) ??
    input.fallback.filter((part): part is string => Boolean(part)).join(" · ");
  return { status: lineStatus, details };
}

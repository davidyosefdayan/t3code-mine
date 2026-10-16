import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";

import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadShells } from "../state/entities";
import { environmentServerConfigsAtom } from "../state/server";
import { setNotificationBadge } from "../threadNotifications";
import { useUiStateStore } from "../uiStateStore";
import {
  filterSidebarV2VisibleThreads,
  isSidebarThreadWorking,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
} from "./Sidebar.logic";

// Personal build: the sidebar's "Unread" rule and the Dock badge count.
// Unread means it became your turn and you haven't looked: a finished turn,
// an approval or question, a failure, or a woken snooze. Reading the chat
// (opening it, or Mark as read) clears it.

type YourTurnInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "runtime"
  | "updatedAt"
  | "latestRun"
>;

/** When it last became your turn in a thread: an approval or question
    appeared (the agent stops there, so the thread's last update), the run
    failed or hit a limit, or a turn finished. Null while nothing has. */
export function yourTurnSince(thread: YourTurnInput): string | null {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval" || status === "input") return thread.updatedAt;
  if (status === "failed" || status === "limited") {
    return thread.runtime?.updatedAt ?? thread.updatedAt;
  }
  return thread.latestRun?.completedAt ?? null;
}

/** A snoozed thread that woke and hasn't been looked at since. */
export function isThreadWoke(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
  now: string,
): boolean {
  if (thread.settledOverride === "settled") return false;
  const wokeAt = threadWokeAt(thread, { now });
  const wokeMs = wokeAt === null ? Number.NaN : Date.parse(wokeAt);
  if (Number.isNaN(wokeMs)) return false;
  const visitedMs = lastVisitedAt === undefined ? Number.NaN : Date.parse(lastVisitedAt);
  return Number.isNaN(visitedMs) || visitedMs < wokeMs;
}

/** It became your turn (or a snooze woke) after you last looked. Callers
    rule out working threads first. `lastVisitedAt` is the effective mark
    (`resolveThreadLastVisitedAt`). */
export function isThreadUnread(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
  now: string,
): boolean {
  return isThreadWoke(thread, lastVisitedAt, now) || isYourTurnUnseen(thread, lastVisitedAt);
}

/** It became your turn after you last looked; no clock involved. A
    never-visited thread counts as read, so history doesn't light up, except a
    failed run: like upstream's Failed status, a failure nobody has opened
    (an automation's, say) still needs someone. */
export function isYourTurnUnseen(
  thread: YourTurnInput,
  lastVisitedAt: string | undefined,
): boolean {
  const since = yourTurnSince(thread);
  if (since === null) return false;
  if (lastVisitedAt === undefined) return thread.latestRun?.status === "failed";
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return false;
  const visitedMs = Date.parse(lastVisitedAt);
  return Number.isNaN(visitedMs) || sinceMs > visitedMs;
}

interface NeedsYouCapabilities {
  readonly threadSnooze?: boolean;
  readonly threadSettlement?: boolean;
}

/** How many threads are unread, by the sidebar's rule, across every project,
    pins included. Snoozed, settled, archived, subagent, and still-working
    threads don't count. */
export function countThreadsNeedingYou(
  threads: readonly EnvironmentThreadShell[],
  capabilitiesOf: (thread: EnvironmentThreadShell) => NeedsYouCapabilities | undefined,
  localLastVisitedAtByKey: Readonly<Record<string, string>>,
  now: string,
): number {
  let count = 0;
  for (const thread of filterSidebarV2VisibleThreads(threads, null)) {
    if (isSidebarThreadWorking(thread)) continue;
    const capabilities = capabilitiesOf(thread);
    if (capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now })) continue;
    if (capabilities?.threadSettlement === true && thread.settledOverride === "settled") continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      localLastVisitedAtByKey[key],
    );
    if (isThreadUnread(thread, lastVisitedAt, now)) count += 1;
  }
  return count;
}

/** The unread count for the Dock badge and the rail's Threads dot. */
export function useNeedsYouCount(): number {
  const threads = useThreadShells();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const localLastVisitedAtByKey = useUiStateStore((state) => state.threadLastVisitedAtById);
  // The minute clock, so a woken snooze counts within a minute and the
  // compiler-cached count never reads the clock during render.
  const nowMinute = useNowMinute();
  return countThreadsNeedingYou(
    threads,
    (thread) => serverConfigs.get(thread.environmentId)?.environment.capabilities,
    localLastVisitedAtByKey,
    `${nowMinute}:00.000Z`,
  );
}

/**
 * The Dock badge shows how many chats need you and stays while the app is
 * focused, instead of upstream's count of missed notifications.
 */
export function NeedsYouDockBadge() {
  const needsYouCount = useNeedsYouCount();
  useEffect(() => setNotificationBadge(needsYouCount), [needsYouCount]);
  return null;
}

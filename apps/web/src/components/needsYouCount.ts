import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { useMemo } from "react";

import { useThreadShells } from "../state/entities";
import { environmentServerConfigsAtom } from "../state/server";
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

/** It became your turn (or a snooze woke) after you last looked. A
    never-visited thread counts as read, so history doesn't light up. Callers
    rule out working threads first. `lastVisitedAt` is the effective mark
    (`resolveThreadLastVisitedAt`). */
export function isThreadUnread(
  thread: EnvironmentThreadShell,
  lastVisitedAt: string | undefined,
  now: string,
): boolean {
  if (isThreadWoke(thread, lastVisitedAt, now)) return true;
  const since = yourTurnSince(thread);
  if (since === null || lastVisitedAt === undefined) return false;
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
  return useMemo(
    () =>
      countThreadsNeedingYou(
        threads,
        (thread) => serverConfigs.get(thread.environmentId)?.environment.capabilities,
        localLastVisitedAtByKey,
        new Date().toISOString(),
      ),
    [threads, serverConfigs, localLastVisitedAtByKey],
  );
}

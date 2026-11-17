import {
  isCompactionCommandMessage,
  isListedThreadLineage,
  type OrchestrationV2ThreadProjection,
  type RunId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { COMPACTION_SUGGESTION_MIN_TOKENS } from "./claudeCompaction.ts";

// Start this long before the cache expires: enough for the session to resume
// and send the compaction while the cache is still warm.
const LEAD_MS = 2 * 60_000;

type Projection = OrchestrationV2ThreadProjection;

/** The records the rule reads. A server projection and the client's thread structure both fit. */
export interface IdleCompactionRecords {
  readonly thread: Omit<Projection["thread"], "updatedAt" | "lastVisitedAt">;
  readonly runs: Projection["runs"];
  readonly messages: Projection["messages"];
  readonly providerThreads: Projection["providerThreads"];
  readonly providerTurns: Projection["providerTurns"];
  readonly runtimeRequests: Projection["runtimeRequests"];
  readonly contextTransfers: Projection["contextTransfers"];
}

export type IdleCompactionHold =
  | "request"
  | "merge_back"
  | "settled"
  | "snoozed"
  | "unfinished"
  | "compacted"
  /** Nothing to read the cache or the last prompt from. */
  | "unknown";

/**
 * Personal build: what idle compaction will do with a Claude thread, and why.
 * The server compacts on `scheduled`; the thread details card shows every case.
 */
export type IdleCompactionStatus =
  /** Not a listed Claude thread with a session T3 can compact. */
  | { readonly type: "unavailable" }
  /** The chat's own switch is off. */
  | { readonly type: "off" }
  /** A turn is running; `afterTurn` when its agent asked to compact once it ends. */
  | { readonly type: "working"; readonly afterTurn: boolean }
  | { readonly type: "small"; readonly cacheEndMs: number | null }
  | {
      readonly type: "held";
      readonly reason: IdleCompactionHold;
      readonly cacheEndMs: number | null;
    }
  | { readonly type: "expired"; readonly cacheEndMs: number }
  | {
      readonly type: "scheduled";
      readonly runId: RunId;
      readonly startMs: number;
      readonly cacheEndMs: number;
      /** The agent asked for it, so it starts as soon as the turn ends. */
      readonly requested: boolean;
    };

const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);

/** The newest provider usage for the thread's active session: its context size and cache expiry. */
export function latestSessionUsage(
  records: Pick<IdleCompactionRecords, "thread" | "providerTurns">,
) {
  return records.providerTurns
    .filter(
      (turn) =>
        turn.providerThreadId === records.thread.activeProviderThreadId &&
        turn.tokenUsage !== undefined,
    )
    .map((turn) => turn.tokenUsage!)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export function idleCompactionStatus(
  records: IdleCompactionRecords,
  nowMs: number,
): IdleCompactionStatus {
  const { thread, runs, messages, providerThreads, runtimeRequests, contextTransfers } = records;
  if (thread.deletedAt !== null || thread.archivedAt !== null) return { type: "unavailable" };
  if (!isListedThreadLineage(thread.lineage)) return { type: "unavailable" };
  const providerThread = providerThreads.find(
    (candidate) => candidate.id === thread.activeProviderThreadId,
  );
  if (
    providerThread?.driver !== "claudeAgent" ||
    providerThread.providerInstanceId !== thread.providerInstanceId
  )
    return { type: "unavailable" };
  if (thread.autoCompactDisabledAt != null) return { type: "off" };
  const activeRun = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (activeRun !== undefined)
    return { type: "working", afterTurn: thread.compactAfterRunId === activeRun.id };

  const usage = latestSessionUsage(records);
  const expiresAt = usage?.promptCacheExpiresAt;
  const parsedEnd = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt);
  const cacheEndMs = Number.isFinite(parsedEnd) ? parsedEnd : null;
  if ((usage?.usedTokens ?? 0) < COMPACTION_SUGGESTION_MIN_TOKENS)
    return { type: "small", cacheEndMs };
  const held = (reason: IdleCompactionHold) => ({ type: "held" as const, reason, cacheEndMs });

  if (thread.settledAt !== null || thread.settledOverride === "settled") return held("settled");
  if (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
    return held("snoozed");
  // A removed or steered queued message leaves a cancelled run that never started.
  const latestRun = runs
    .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
    .reduce<(typeof runs)[number] | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );
  if (latestRun?.status !== "completed" || latestRun.completedAt === null)
    return held("unfinished");
  if (
    latestRun.providerThreadId !== providerThread.id ||
    latestRun.providerInstanceId !== thread.providerInstanceId
  )
    return { type: "unavailable" };
  const message = messages.find((candidate) => candidate.id === latestRun.userMessageId);
  // Never compact a compaction, so one idle spell compacts at most once.
  if (message === undefined) return held("unknown");
  if (isCompactionCommandMessage(message)) return held("compacted");
  if (runtimeRequests.some((request) => request.status === "pending")) return held("request");
  // A pending merge-back belongs to the user's next message.
  if (
    contextTransfers.some(
      (transfer) =>
        transfer.type === "merge_back" &&
        transfer.targetThreadId === thread.id &&
        transfer.status === "pending",
    )
  )
    return held("merge_back");
  // A request served fully from cache reports no TTL, though it still refreshed the cache.
  if (cacheEndMs === null) return held("unknown");
  if (nowMs >= cacheEndMs) return { type: "expired", cacheEndMs };
  const requested = thread.compactAfterRunId === latestRun.id;
  return {
    type: "scheduled",
    runId: latestRun.id,
    startMs: requested
      ? Math.min(DateTime.toEpochMillis(latestRun.completedAt), cacheEndMs - LEAD_MS)
      : cacheEndMs - LEAD_MS,
    cacheEndMs,
    requested,
  };
}

import {
  CommandId,
  IDLE_COMPACTION_TEXT,
  MessageId,
  type ProviderThreadId,
  resolveIdleCompaction,
  resolveProjectProviderInstanceEnabled,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { idleCompactionStatus } from "@t3tools/shared/idleCompactionStatus";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

// Personal build: the longest prompt cache Claude reports. Threads whose last run ended
// within it may still be warm after a restart.
const MAX_PROMPT_CACHE_MS = 60 * 60_000;

const compactionMessageId = (threadId: ThreadId, runId: RunId) =>
  MessageId.make(`idle-compact:${threadId}:${runId}`);

/**
 * Sends `/compact` to an idle Claude thread shortly before its prompt cache expires, or as soon
 * as a run ends when its agent asked (`t3_compact_after_turn`). Personal build: work that ends
 * during the compaction may fold its report into it, so the agent is woken to carry on.
 */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  // Background tasks still running when each compaction was sent, by thread.
  const compactingWithWork = new Map<
    ThreadId,
    { readonly messageId: MessageId; readonly taskIds: ReadonlySet<string> }
  >();

  const readRecords = (
    threadId: ThreadId,
    runId: RunId,
    activeProviderThreadId: ProviderThreadId | null,
  ) => {
    const activeProviderThreadIds = activeProviderThreadId === null ? [] : [activeProviderThreadId];
    return projections.getThreadRecords(
      threadId,
      [
        "runs",
        "messages",
        "providerThreads",
        "providerTurns",
        "runtimeRequests",
        "turnItems",
        "contextTransfers",
      ],
      {
        messageRunIds: [runId],
        turnItemStatuses: ["pending", "running", "waiting"],
        // The latest run, active runs that hold background work, and rolled-back runs whose
        // items it ignores.
        runStatuses: ["preparing", "starting", "running", "waiting", "rolled_back"],
        includeLatestRun: true,
        // Without an active provider thread there is no session to compact.
        providerThreadIds: activeProviderThreadIds,
        providerTurnThreadIds: activeProviderThreadIds,
        latestProviderTurnUsageOnly: true,
        runtimeRequestStatuses: ["pending"],
        contextTransferStatuses: ["pending"],
      },
    );
  };

  const pendingTaskIds = (records: Effect.Success<ReturnType<typeof readRecords>>) => {
    const latestRun = records.runs.reduce<(typeof records.runs)[number] | undefined>(
      (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
      undefined,
    );
    return new Set(
      derivePendingBackgroundWork({
        latestRun,
        runs: records.runs,
        providerThreads: records.providerThreads,
        turnItems: records.turnItems,
        activeProviderThreadId: records.thread.activeProviderThreadId,
      }).map((task) => task.taskId),
    );
  };

  /** After a compaction sent while background work ran, wakes the agent if that work ended. */
  const wakeAfterCompaction = Effect.fn("IdleCompactionService.wakeAfterCompaction")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      const pending = compactingWithWork.get(threadId);
      if (pending === undefined) return;
      const thread = yield* projections.getThread(threadId);
      const records = yield* readRecords(threadId, completedRunId, thread.activeProviderThreadId);
      const compaction = records.runs.find((run) => run.id === completedRunId);
      if (compaction?.userMessageId !== pending.messageId) return;
      compactingWithWork.delete(threadId);
      const stillPending = pendingTaskIds(records);
      const finished = [...pending.taskIds].filter((taskId) => !stillPending.has(taskId));
      // Claude woke the agent itself: a later run is already queued or running.
      const laterRun = records.runs.some(
        (run) => run.ordinal > compaction.ordinal && run.status !== "cancelled",
      );
      if (finished.length === 0 || laterRun) return;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`server:idle-compact-wake:${threadId}:${completedRunId}`),
        messageId: MessageId.make(`idle-compact-wake:${threadId}:${completedRunId}`),
        threadId,
        text: `Background work finished while this chat was compacting (${finished.join(", ")}). Check its result and carry on.`,
        attachments: [],
        createdBy: "agent",
        creationSource: "server",
        dispatchMode: { type: "start_immediately" },
      });
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("wake after compaction skipped", { threadId, cause }),
        ),
      ),
  );

  const compactWhenDue = Effect.fn("IdleCompactionService.compactWhenDue")(
    function* (threadId: ThreadId, completedRunId: RunId) {
      let runId = completedRunId;
      // Loops after the wait or a retarget: the thread may have moved on.
      while (true) {
        const current = yield* settings.getSettings;
        const thread = yield* projections.getThread(threadId);
        const claudeInstance = Object.hasOwn(current.providerInstances, thread.providerInstanceId)
          ? current.providerInstances[thread.providerInstanceId]?.driver === "claudeAgent"
          : thread.providerInstanceId === "claudeAgent";
        const mode = resolveIdleCompaction(current, thread.providerInstanceId);
        if (
          !claudeInstance ||
          mode === "off" ||
          // Under "When you return" only a compaction the agent asked for runs here.
          (mode === "onReturn" && thread.compactAfterRunId !== runId) ||
          thread.autoCompactDisabledAt != null ||
          !resolveProjectProviderInstanceEnabled(
            current,
            thread.projectId,
            thread.providerInstanceId,
          )
        )
          return;
        const records = yield* readRecords(threadId, runId, thread.activeProviderThreadId);
        const latestRun = records.runs
          .filter((run) => run.status !== "cancelled" || run.startedAt !== null)
          .reduce<(typeof records.runs)[number] | undefined>(
            (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
            undefined,
          );
        // A late update for an earlier run replaced the latest run's timer, so take it over.
        if (latestRun?.status === "completed" && latestRun.id !== runId) {
          runId = latestRun.id;
          continue;
        }
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        const status = idleCompactionStatus(records, nowMs);
        if (status.type !== "scheduled" || status.runId !== runId) return;
        if (mode !== "beforeCacheExpires" && !status.requested) return;
        if (nowMs < status.startMs) {
          yield* Effect.sleep(Duration.millis(status.startMs - nowMs));
          continue;
        }
        const messageId = compactionMessageId(threadId, runId);
        const taskIds = pendingTaskIds(records);
        if (taskIds.size > 0) compactingWithWork.set(threadId, { messageId, taskIds });
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          // One compaction per completed run, even across duplicate events.
          commandId: CommandId.make(`server:idle-compact:${threadId}:${runId}`),
          messageId,
          threadId,
          text: IDLE_COMPACTION_TEXT,
          attachments: [],
          createdBy: "agent",
          creationSource: "server",
          idleCompaction: "beforeCacheExpires",
          dispatchMode: { type: "start_immediately" },
        });
        return;
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.catch((cause) => Effect.logWarning("idle compaction skipped", { threadId, cause })),
      ),
  );

  const start = Effect.fn("IdleCompactionService.start")(function* () {
    // Keyed by thread: a newer completed run replaces the waiting timer.
    const timers = yield* FiberMap.make<ThreadId>();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        event.type === "run.updated" && event.payload.status === "completed"
          ? wakeAfterCompaction(event.threadId, event.payload.id).pipe(
              Effect.andThen(
                FiberMap.run(
                  timers,
                  event.threadId,
                  compactWhenDue(event.threadId, event.payload.id),
                ),
              ),
            )
          : Effect.void,
      ),
    );
    // Personal build: timers live in memory, so re-arm threads whose cache may still be warm.
    const since = DateTime.subtract(yield* DateTime.now, { milliseconds: MAX_PROMPT_CACHE_MS });
    const recent = yield* projections
      .getRecentlyCompletedRuns(since)
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("idle compaction restart scan failed", { cause }).pipe(
            Effect.as([] as const),
          ),
        ),
      );
    yield* Effect.forEach(
      recent,
      ({ threadId, runId }) =>
        FiberMap.run(timers, threadId, compactWhenDue(threadId, runId), { onlyIfMissing: true }),
      { discard: true },
    );
  });
  return { start };
});

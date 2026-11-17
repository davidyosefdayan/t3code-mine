import {
  isCompactionCommandMessage,
  OrchestratorMcpFailure,
  resolveIdleCompaction,
} from "@t3tools/contracts";
import { COMPACTION_SUGGESTION_MIN_TOKENS } from "@t3tools/shared/claudeCompaction";
import { latestSessionUsage } from "@t3tools/shared/idleCompactionStatus";
import * as Effect from "effect/Effect";

import { visibleThreadPullRequests } from "../../../sourceControl/threadPullRequests.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, newCommandId, readThread, unavailable } from "../../threadAccess.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import { MessagesToolkit } from "./tools.ts";

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

// Personal build: the message is shown from the call's own tool item, so the
// handler only confirms it. Only an agent inside a thread has a chat to show it in.
export const layer = McpToolAccess.toLayer(MessagesToolkit, {
  message_user: McpToolAccess.readsAsCaller(() => Effect.succeed({ shown: true })),
  t3_needs_you: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const { threads, projection } = yield* readThread(input.threadId);
        const thread = projection.thread;
        if (input.action === "clear") {
          yield* threads
            .dispatch({
              type: "thread.waiting-on-you.set",
              commandId: yield* newCommandId(),
              threadId: thread.id,
              waitingOnYou: null,
            })
            .pipe(Effect.mapError(dispatchFailure));
          return { waitingOnYou: null };
        }
        if (input.kind === undefined || input.reason === undefined) {
          return yield* invalid("set needs `kind` and `reason`.");
        }
        if (input.wakeOnMerge === true && input.pullRequest === undefined) {
          return yield* invalid("`wakeOnMerge` needs `pullRequest`.");
        }
        const linked =
          input.pullRequest === undefined
            ? undefined
            : visibleThreadPullRequests(thread.pullRequests ?? []).find(
                (link) => link.number === input.pullRequest,
              );
        if (input.pullRequest !== undefined && linked === undefined) {
          return yield* invalid(
            `PR #${input.pullRequest} is not linked to this thread. Link it with link_pull_request first.`,
          );
        }
        const waitingOnYou = {
          kind: input.kind,
          reason: input.reason,
          ...(linked === undefined
            ? {}
            : {
                pullRequest: {
                  host: linked.host,
                  repository: linked.repository,
                  number: linked.number,
                },
              }),
          ...(input.wakeOnMerge === undefined ? {} : { wakeOnMerge: input.wakeOnMerge }),
        };
        yield* threads
          .dispatch({
            type: "thread.waiting-on-you.set",
            commandId: yield* newCommandId(),
            threadId: thread.id,
            waitingOnYou,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { waitingOnYou };
      }),
  ),
  t3_compact_after_turn: McpToolAccess.writesThreads(
    () => [undefined],
    (input) =>
      Effect.gen(function* () {
        const { threads, projection } = yield* readThread(undefined, [
          "runs",
          "messages",
          "providerThreads",
          "providerTurns",
        ]);
        const thread = projection.thread;
        const setAfterRun = (afterRunId: (typeof projection.runs)[number]["id"] | null) =>
          newCommandId().pipe(
            Effect.flatMap((commandId) =>
              threads.dispatch({
                type: "thread.auto-compact.set",
                commandId,
                threadId: thread.id,
                afterRunId,
              }),
            ),
            Effect.mapError(dispatchFailure),
          );
        if (input.cancel === true) {
          yield* setAfterRun(null);
          return { scheduled: false };
        }
        const activeRun = projection.runs.find(
          (run) =>
            run.status === "preparing" || run.status === "starting" || run.status === "running",
        );
        if (activeRun === undefined) return yield* invalid("Call it during a turn.");
        const message = projection.messages.find((entry) => entry.id === activeRun.userMessageId);
        if (message !== undefined && isCompactionCommandMessage(message)) {
          return yield* invalid("This turn is already a compaction.");
        }
        const providerThread = projection.providerThreads.find(
          (entry) => entry.id === thread.activeProviderThreadId,
        );
        if (providerThread?.driver !== "claudeAgent") {
          return { scheduled: false, reason: "Only Claude threads can be compacted this way." };
        }
        if (thread.autoCompactDisabledAt != null) {
          return {
            scheduled: false,
            reason: "The user switched auto-compact off for this thread.",
          };
        }
        const settings = yield* ServerSettings.ServerSettingsService;
        const current = yield* settings.getSettings.pipe(Effect.mapError(() => unavailable()));
        if (resolveIdleCompaction(current, thread.providerInstanceId) === "off") {
          return { scheduled: false, reason: "The user switched compaction off in Settings." };
        }
        if ((latestSessionUsage(projection)?.usedTokens ?? 0) < COMPACTION_SUGGESTION_MIN_TOKENS) {
          return { scheduled: false, reason: "This thread is under 200,000 tokens; no need." };
        }
        yield* setAfterRun(activeRun.id);
        return { scheduled: true };
      }),
  ),
});

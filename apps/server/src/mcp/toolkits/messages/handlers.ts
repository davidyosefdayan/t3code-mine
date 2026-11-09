import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { visibleThreadPullRequests } from "../../../sourceControl/threadPullRequests.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, newCommandId, readThread } from "../../threadAccess.ts";
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
});

import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, loadCaller, newCommandId } from "../../threadAccess.ts";
import { MessagesToolkit } from "./tools.ts";

// Personal build: the message is shown from the call's own tool item, so the
// handler only confirms it. Only an agent inside a thread has a chat to show it in.
export const layer = McpToolAccess.toLayer(MessagesToolkit, {
  message_user: McpToolAccess.readsAsCaller(() => Effect.succeed({ shown: true })),
  t3_waiting_on_user: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threads, caller } = yield* loadCaller();
      if (caller === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "target_required",
          message: "This tool marks the thread it runs in.",
        });
      }
      const waitingOnYou =
        input.action === "clear"
          ? null
          : input.kind === undefined || input.reason === undefined
            ? yield* new OrchestratorMcpFailure({
                code: "invalid_request",
                message: "set needs `kind` and `reason`.",
              })
            : { kind: input.kind, reason: input.reason };
      yield* threads
        .dispatch({
          type: "thread.waiting-on-you.set",
          commandId: yield* newCommandId(),
          threadId: caller.id,
          waitingOnYou,
        })
        .pipe(Effect.mapError(dispatchFailure));
      return { waitingOnYou };
    }),
  ),
});

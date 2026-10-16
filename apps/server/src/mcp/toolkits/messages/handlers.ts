import * as Effect from "effect/Effect";

import * as McpToolAccess from "../../McpToolAccess.ts";
import { MessagesToolkit } from "./tools.ts";

// Personal build: the message is shown from the call's own tool item, so the
// handler only confirms it. Only an agent inside a thread has a chat to show it in.
export const layer = McpToolAccess.toLayer(MessagesToolkit, {
  message_user: McpToolAccess.readsAsCaller(() => Effect.succeed({ shown: true })),
});

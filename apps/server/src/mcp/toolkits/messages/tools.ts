import {
  OrchestratorMcpFailure,
  PositiveInt,
  ThreadId,
  ThreadWaitingOnYouKind,
  ThreadWaitingOnYouReason,
  ThreadWaitingOnYouRequest,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Personal build: an agent puts a thread in "Needs you", with a reason the
// sidebar shows, when the user or a skill asks. Pending prompts count without it.
const NeedsYouTool = Tool.make("t3_needs_you", {
  description:
    "Put a thread in the user's \"Needs you\" section with a short reason, or take it out. Omit `threadId` for this thread. Use it only when the user or a skill tells you to, such as when a PR is ready to merge; don't use it on your own. It stays until cleared, and reading the thread doesn't clear it. With `pullRequest`, T3 clears it when that PR merges or closes. `guardPullRequest` also clears it when the PR stops being ready to merge (a failed check, a conflict, or changes requested) and wakes you then and after the merge. Pending approvals and questions show there without this.",
  parameters: Schema.Struct({
    action: Schema.Literals(["set", "clear"]),
    kind: Schema.optional(ThreadWaitingOnYouKind).annotate({
      description:
        "For set. merge: a PR to merge. decision: a choice or question. review: something to look at or test. credential: a key, login, or secret. other: anything else.",
    }),
    reason: Schema.optional(ThreadWaitingOnYouReason).annotate({
      description:
        'For set. One short line on what they need to do, like "PR #1058 is ready to merge".',
    }),
    pullRequest: Schema.optional(PositiveInt).annotate({
      description: "For set. The number of a PR linked to the thread that this waits on.",
    }),
    guardPullRequest: Schema.optional(Schema.Boolean).annotate({
      description:
        "For set with pullRequest. Wake this thread's agent when the PR merges or stops being ready to merge.",
    }),
    threadId: Schema.optional(ThreadId),
  }),
  success: Schema.Struct({
    waitingOnYou: Schema.NullOr(ThreadWaitingOnYouRequest),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SecureRandom.SecureRandom,
  ],
})
  .annotate(Tool.Title, "Needs you")
  // It changes only how the user's sidebar shows this thread, so it never asks.
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(Tool.Meta, { "anthropic/alwaysLoad": true });

// Personal build: an agent can't run /compact on itself, so it asks T3 to compact its own
// thread once the current turn ends, at a checkpoint a skill names.
const CompactAfterTurnTool = Tool.make("t3_compact_after_turn", {
  description:
    "Compact this thread once your current turn ends, so the next turn starts from a summary instead of re-reading the whole conversation. Use it only when a skill or the user tells you to, at a checkpoint where work will continue later. Never use it when the work is finished. It applies only to Claude threads over 200,000 tokens, and the user can switch it off for a thread. Your turn carries on normally; `cancel` withdraws the request.",
  parameters: Schema.Struct({
    cancel: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({
    scheduled: Schema.Boolean,
    reason: Schema.optional(Schema.String),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerSettings.ServerSettingsService,
    SecureRandom.SecureRandom,
  ],
})
  .annotate(Tool.Title, "Compact after this turn")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const MessagesToolkit = Toolkit.make(NeedsYouTool, CompactAfterTurnTool);

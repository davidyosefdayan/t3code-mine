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

/**
 * Personal build: the agent's way to talk to the user mid-turn. Clients fold
 * text written between tool calls into the work log as progress notes; a
 * `message_user` call is shown in the chat as the agent speaking. The call is
 * the record (its input is kept as the turn's tool item), so the handler has
 * nothing to do.
 */
export const MessageUserTool = Tool.make("message_user", {
  description:
    "Show the user a message in the chat now, while you keep working. Text you write between tool calls is folded away with your work as a progress note, so the user may never read it. Use this for anything the user should read before your turn ends: an answer to their question when you still have work to do, a finding, or a decision they should know about. Don't use it for short status updates, and don't use it for your final reply: end your turn with plain text as usual. Markdown is supported.",
  parameters: Schema.Struct({
    message: Schema.String.annotate({
      description: "What to tell the user, in Markdown.",
    }),
  }),
  success: Schema.Struct({
    shown: Schema.Boolean,
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Message the user")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  // Claude Code defers MCP tools behind tool search by default; an agent that
  // has to search for this tool first mostly won't.
  .annotate(Tool.Meta, { "anthropic/alwaysLoad": true });

// Personal build: an agent puts a thread in "Needs you", with a reason the
// sidebar shows, when the user or a skill asks. Pending prompts count without it.
const NeedsYouTool = Tool.make("t3_needs_you", {
  description:
    "Put a thread in the user's \"Needs you\" section with a short reason, or take it out. Omit `threadId` for this thread. Use it only when the user or a skill tells you to, such as when a PR is ready to merge; don't use it on your own. It stays until cleared, and reading the thread doesn't clear it. With `pullRequest`, T3 clears it when that PR merges or closes, and `wakeOnMerge` wakes you after the merge. Pending approvals and questions show there without this.",
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
    wakeOnMerge: Schema.optional(Schema.Boolean).annotate({
      description: "For set with pullRequest. Wake this thread's agent once the PR merges.",
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

export const MessagesToolkit = Toolkit.make(MessageUserTool, NeedsYouTool, CompactAfterTurnTool);

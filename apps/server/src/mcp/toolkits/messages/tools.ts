import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

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

export const MessagesToolkit = Toolkit.make(MessageUserTool);

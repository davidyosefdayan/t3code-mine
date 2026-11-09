import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadPullRequestKey } from "./threadPullRequest.ts";

/**
 * Personal build: what an agent handed back to the user, set and cleared by
 * the agent through `t3_needs_you`. Reading the thread never clears it.
 */
export const ThreadWaitingOnYouKind = Schema.Literals([
  "merge",
  "decision",
  "review",
  "credential",
  "other",
]);
export type ThreadWaitingOnYouKind = typeof ThreadWaitingOnYouKind.Type;

export const ThreadWaitingOnYouReason = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

/** What the agent sets. A named pull request clears the mark when it merges or
    closes, and `wakeOnMerge` then wakes the agent to carry on. */
export const ThreadWaitingOnYouRequest = Schema.Struct({
  kind: ThreadWaitingOnYouKind,
  reason: ThreadWaitingOnYouReason,
  pullRequest: Schema.optional(ThreadPullRequestKey),
  wakeOnMerge: Schema.optional(Schema.Boolean),
});

export const ThreadWaitingOnYou = Schema.Struct({
  ...ThreadWaitingOnYouRequest.fields,
  since: IsoDateTime,
});
export type ThreadWaitingOnYou = typeof ThreadWaitingOnYou.Type;

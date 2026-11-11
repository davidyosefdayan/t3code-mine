import * as Schema from "effect/Schema";

import { IsoDateTime, RuntimeRequestId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadPullRequestKey } from "./threadPullRequest.ts";

/**
 * Personal build: what an agent handed back to the user, set and cleared by
 * the agent through `t3_needs_you`. Reading the thread never clears it; a reply
 * does, unless the mark waits on a pull request.
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

/**
 * Personal build: official T3 Code apps don't know the mark, so the server also
 * reports it as an open question ("Awaiting Input"), like upstream's link cards.
 * Mine knows the mark and drops that request, so it looks exactly as before.
 */
const WAITING_ON_YOU_REQUEST_PREFIX = "waiting-on-you:";

export const waitingOnYouRequestId = (threadId: string) =>
  RuntimeRequestId.make(`${WAITING_ON_YOU_REQUEST_PREFIX}${threadId}`);

export const isWaitingOnYouRequest = (request: { readonly id: string } | null | undefined) =>
  request?.id.startsWith(WAITING_ON_YOU_REQUEST_PREFIX) === true;

export function withoutWaitingOnYouRequest<
  T extends { readonly pendingRuntimeRequest: { readonly id: string } | null },
>(thread: T): T {
  return isWaitingOnYouRequest(thread.pendingRuntimeRequest)
    ? { ...thread, pendingRuntimeRequest: null }
    : thread;
}

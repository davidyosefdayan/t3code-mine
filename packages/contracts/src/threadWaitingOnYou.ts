import * as Schema from "effect/Schema";

import { IsoDateTime, MessageId, RuntimeRequestId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ThreadPullRequestKey, type ThreadPullRequestSnapshot } from "./threadPullRequest.ts";

/**
 * Personal build: what an agent handed back to the user, set and cleared by
 * the agent through `t3_needs_you`. Reading the thread never clears it; a reply
 * does, unless it is a merge mark waiting on a pull request.
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
    closes. `guardPullRequest` also clears it when the pull request stops being ready
    to merge, and wakes the agent then and after the merge. */
export const ThreadWaitingOnYouRequest = Schema.Struct({
  kind: ThreadWaitingOnYouKind,
  reason: ThreadWaitingOnYouReason,
  pullRequest: Schema.optional(ThreadPullRequestKey),
  guardPullRequest: Schema.optional(Schema.Boolean),
  /** Marks saved before `guardPullRequest`; read the same way. */
  wakeOnMerge: Schema.optional(Schema.Boolean),
});

export const ThreadWaitingOnYou = Schema.Struct({
  ...ThreadWaitingOnYouRequest.fields,
  since: IsoDateTime,
});
export type ThreadWaitingOnYou = typeof ThreadWaitingOnYou.Type;

/**
 * Personal build: a mark the user took down, by replying or with Dismiss. The agent is told with
 * the user's reply, or with their next message after a dismiss (bound to it as `messageId`).
 */
export const ThreadWaitingOnYouNotice = Schema.Struct({
  via: Schema.Literals(["reply", "dismiss"]),
  kind: ThreadWaitingOnYouKind,
  reason: ThreadWaitingOnYouReason,
  messageId: Schema.optional(MessageId),
});
export type ThreadWaitingOnYouNotice = typeof ThreadWaitingOnYouNotice.Type;

/** The user's message as the agent reads it, with the notice bound to that message. */
export function withWaitingOnYouNotice(
  text: string,
  messageId: string,
  notice: ThreadWaitingOnYouNotice | null | undefined,
): string {
  if (notice == null || notice.messageId !== messageId) return text;
  const note =
    notice.via === "reply"
      ? `T3 Code took this thread out of Needs you ("${notice.reason}") because the user replied. Set it again with t3_needs_you if you still need them.`
      : `Earlier, the user dismissed this thread's Needs you ("${notice.reason}") in T3 Code. Set it again with t3_needs_you if you still need them.`;
  return `${text}\n\n<needs_you_cleared>\n${note}\n</needs_you_cleared>`;
}

/** Why an open pull request can't merge as it stands, from the last synced snapshot. */
export function pullRequestNotReadyReasons(
  snapshot:
    | Pick<ThreadPullRequestSnapshot, "checksState" | "mergeability" | "reviewDecision">
    | null
    | undefined,
): ReadonlyArray<string> {
  if (snapshot == null) return [];
  return [
    ...(snapshot.checksState === "failing" ? ["a check failed"] : []),
    ...(snapshot.mergeability === "conflicting" ? ["it has a merge conflict"] : []),
    ...(snapshot.reviewDecision === "changes-requested" ? ["a reviewer requested changes"] : []),
  ];
}

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

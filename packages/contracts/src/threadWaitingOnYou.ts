import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

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

export const ThreadWaitingOnYou = Schema.Struct({
  kind: ThreadWaitingOnYouKind,
  reason: ThreadWaitingOnYouReason,
  since: IsoDateTime,
});
export type ThreadWaitingOnYou = typeof ThreadWaitingOnYou.Type;

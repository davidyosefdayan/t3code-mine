// Personal build: Settings → Storage lists every worktree folder with its size
// and last cleanup outcome, and can free its packages or delete it.
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestState } from "./pullRequest.ts";

export const StorageWorktreeEntry = Schema.Struct({
  path: Schema.String,
  /** The thread's project, or the repository folder's name for folders without a thread. */
  projectName: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  threadTitle: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(
    Schema.Struct({
      number: Schema.Number,
      url: Schema.String,
      state: Schema.NullOr(PullRequestState),
    }),
  ),
  /** Null until measured, or when the folder could not be measured. */
  bytes: Schema.NullOr(Schema.Number),
  /** Rebuildable folders inside it, such as node_modules. */
  packageBytes: Schema.NullOr(Schema.Number),
  measured: Schema.Boolean,
  lastCleanup: Schema.NullOr(
    Schema.Struct({
      outcome: Schema.Literals(["removed", "kept", "failed"]),
      reason: Schema.String,
      finishedAt: Schema.String,
    }),
  ),
});
export type StorageWorktreeEntry = typeof StorageWorktreeEntry.Type;

export const StorageWorktreeList = Schema.Struct({
  entries: Schema.Array(StorageWorktreeEntry),
  measuring: Schema.Boolean,
});
export type StorageWorktreeList = typeof StorageWorktreeList.Type;

export const StorageWorktreeTarget = Schema.Struct({ path: TrimmedNonEmptyString });
export type StorageWorktreeTarget = typeof StorageWorktreeTarget.Type;

export const StorageWorktreeFreeResult = Schema.Struct({
  folders: Schema.Number,
  bytes: Schema.Number,
});
export type StorageWorktreeFreeResult = typeof StorageWorktreeFreeResult.Type;

export const StorageWorktreeDeleteInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  /** Report what deleting would keep and lose, without deleting. */
  dryRun: Schema.Boolean,
  /** Delete even with uncommitted changes or files too large to back up. */
  allowLocalChanges: Schema.Boolean,
});
export type StorageWorktreeDeleteInput = typeof StorageWorktreeDeleteInput.Type;

export const StorageWorktreeDeletePlan = Schema.Struct({
  removed: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
  /** Edited, staged, and untracked files. They are backed up before deleting. */
  changedFiles: Schema.Number,
  /** Files only this worktree has, copied to the backup folder before deleting. */
  backupFiles: Schema.Number,
  backupPath: Schema.NullOr(Schema.String),
  /** First ignored path that is too large to back up and would be lost, if any. */
  notBackedUp: Schema.NullOr(Schema.String),
  /** True when the delete needs `allowLocalChanges`. */
  needsConfirmation: Schema.Boolean,
});
export type StorageWorktreeDeletePlan = typeof StorageWorktreeDeletePlan.Type;

export class StorageWorktreeError extends Schema.TaggedError<StorageWorktreeError>()(
  "StorageWorktreeError",
  { message: Schema.String },
) {}

// Personal build: a terminal opened in a chat whose worktree cleanup removed brings
// the worktree back first, as sending a message does. Mirrors the private
// recreateMissingWorktree in ProviderTurnStartService; drop if upstream covers terminals.
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { makeIsManagedWorktreePath } from "../worktreesDirectory.ts";

export const makeTerminalWorktreeRecovery = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const isManagedWorktreePath = yield* makeIsManagedWorktreePath;

  const resolveBase = Effect.fn("terminalWorktreeRecovery.resolveBase")(function* (cwd: string) {
    yield* gitWorkflow.invalidateLocalStatus(cwd);
    const { refName: currentBranch } = yield* gitWorkflow.localStatus({ cwd });
    if (currentBranch !== null) {
      const refName = `refs/heads/${currentBranch}`;
      return { refName, baseRefName: refName as string | undefined };
    }
    if (yield* gitWorkflow.hasCommit({ cwd, refName: "refs/remotes/origin/HEAD" })) {
      const { commitSha } = yield* gitWorkflow.resolveRemoteTrackingCommit({
        cwd,
        refName: "HEAD",
        fallbackRemoteName: "origin",
      });
      return { refName: commitSha, baseRefName: "refs/remotes/origin/HEAD" as string | undefined };
    }
    if (yield* gitWorkflow.hasCommit({ cwd, refName: "HEAD" })) {
      return { refName: "HEAD", baseRefName: undefined };
    }
    return null;
  });

  const recreate = Effect.fn("terminalWorktreeRecovery.recreate")(function* (input: {
    readonly cwd: string;
    readonly worktreePath: string;
    readonly branch: string;
  }) {
    const { cwd, worktreePath, branch } = input;
    yield* gitWorkflow.pruneWorktrees({ cwd });
    const localBranchNames = yield* gitWorkflow.listLocalBranchNames(cwd);
    if (localBranchNames.includes(branch)) {
      yield* gitWorkflow.createWorktree({ cwd, refName: branch, path: worktreePath });
      return;
    }
    const pushedRef = `refs/remotes/origin/${branch}`;
    if (yield* gitWorkflow.hasCommit({ cwd, refName: pushedRef })) {
      yield* gitWorkflow.createWorktree({
        cwd,
        refName: pushedRef,
        newRefName: branch,
        path: worktreePath,
      });
      return;
    }
    const base = yield* resolveBase(cwd);
    if (base === null) return;
    yield* gitWorkflow.createWorktree({
      cwd,
      refName: base.refName,
      newRefName: branch,
      ...(base.baseRefName === undefined ? {} : { baseRefName: base.baseRefName }),
      path: worktreePath,
    });
  });

  /** Recreates the thread's own worktree when the terminal asks for it and it is gone.
      Anything else (another path, a folder outside T3's worktrees) is left to the
      terminal's usual missing-folder error. */
  return Effect.fn("terminalWorktreeRecovery.ensure")(
    function* (input: { readonly threadId: string; readonly cwd: string }) {
      if (yield* fileSystem.exists(input.cwd).pipe(Effect.orElseSucceed(() => true))) return;
      const thread = yield* threadManagement.getThreadShell(ThreadId.make(input.threadId));
      if (thread === null || thread.worktreePath !== input.cwd || thread.branch === null) return;
      if (!(yield* isManagedWorktreePath(thread.worktreePath))) return;
      const project = Option.getOrUndefined(yield* projects.getById(thread.projectId));
      if (project === undefined) return;
      yield* Effect.logWarning("terminal open recreating missing worktree", {
        threadId: thread.id,
        worktreePath: thread.worktreePath,
        branch: thread.branch,
      });
      yield* recreate({
        cwd: project.workspaceRoot,
        worktreePath: thread.worktreePath,
        branch: thread.branch,
      });
    },
    // A failed recovery falls through to the terminal's own error for the folder.
    Effect.catchCause((cause) => Effect.logWarning("terminal worktree recovery failed", { cause })),
  );
});

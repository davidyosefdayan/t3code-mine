import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { expect, it, vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeTerminalWorktreeRecovery } from "./terminalWorktreeRecovery.ts";

const worktreesDir = "/tmp/terminal-worktree-recovery";
const worktreePath = `${worktreesDir}/project/feature-restore`;

function openTerminal(input: { readonly cwd: string; readonly exists: boolean }) {
  const createWorktree = vi.fn(() => Effect.succeed({} as never));
  const layer = Layer.mergeAll(
    Path.layer,
    Layer.mock(ServerConfig.ServerConfig)({ worktreesDir } as ServerConfig.ServerConfig["Service"]),
    ServerSettings.layerTest(),
    Layer.succeed(FileSystem.FileSystem, {
      exists: () => Effect.succeed(input.exists),
      realPath: (target: string) => Effect.succeed(target),
    } as never),
    Layer.mock(GitWorkflow.GitWorkflowService)({
      pruneWorktrees: () => Effect.void,
      listLocalBranchNames: () => Effect.succeed(["feature/restore"]),
      createWorktree,
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({
          id: ThreadId.make("thread-terminal"),
          projectId: ProjectId.make("project-terminal"),
          branch: "feature/restore",
          worktreePath,
        } as never),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome({ workspaceRoot: "/tmp/terminal-project" } as never),
    }),
  );
  return Effect.gen(function* () {
    const recover = yield* makeTerminalWorktreeRecovery;
    yield* recover({ threadId: "thread-terminal", cwd: input.cwd });
    return createWorktree;
  }).pipe(Effect.provide(layer), Effect.runPromise);
}

it.each([
  { label: "the thread's removed worktree", cwd: worktreePath, exists: false, recreated: true },
  { label: "a worktree that still exists", cwd: worktreePath, exists: true, recreated: false },
  {
    label: "a missing folder that isn't the thread's worktree",
    cwd: `${worktreesDir}/project/other`,
    exists: false,
    recreated: false,
  },
])("a terminal opening in $label recreates it only when it was removed", async (input) => {
  const createWorktree = await openTerminal(input);
  expect(createWorktree).toHaveBeenCalledTimes(input.recreated ? 1 : 0);
});

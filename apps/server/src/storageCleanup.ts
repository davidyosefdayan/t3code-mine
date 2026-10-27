import {
  GitCommandError,
  OrchestrationV2AppThreadJson,
  OrchestrationV2ProviderSessionJson,
  StorageCleanupReport as StorageCleanupReportSchema,
  StorageWorktreeError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  OrchestrationV2ThreadShell,
  ProjectId,
  ServerSettings,
  ServerSettingsError,
  TerminalSummary,
  WorktreeCleanupRules,
  StorageCleanupReport,
  StorageCleanupReportEntry,
  StorageWorktreeDeleteInput,
  StorageWorktreeDeletePlan,
  StorageWorktreeEntry,
  StorageWorktreeFreeResult,
  StorageWorktreeList,
  StorageWorktreeTarget,
} from "@t3tools/contracts";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type { PlatformError } from "effect/PlatformError";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { parse as parseYaml } from "yaml";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionManager from "./orchestration-v2/ProviderSessionManager.ts";
import { threadHasQueuedTurnStart } from "./orchestration-v2/ThreadSettlementService.ts";
import { forkParked } from "./serverActivation.ts";
import * as Settings from "./serverSettings.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import { isFilesystemRoot, managedWorktreesDirectories } from "./worktreesDirectory.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";
import { removeLinkedWorktree } from "./vcs/worktreeRemoval.ts";
import { withWorkspaceLease } from "./workspace/workspaceLease.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { isNetworkPath } from "@t3tools/shared/path";

const decodeCleanupThread = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);
const decodeCleanupSession = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2ProviderSessionJson),
);
// pnpm 11 writes this file as JSON, older versions as YAML.
const SavedReportJson = Schema.fromJsonString(StorageCleanupReportSchema);
const decodeSavedReport = Schema.decodeUnknownEffect(SavedReportJson);
const encodeSavedReport = Schema.encodeEffect(SavedReportJson);
const decodePnpmModulesManifest = Schema.decodeUnknownEffect(
  Schema.Struct({
    storeDir: Schema.String,
    virtualStoreDir: Schema.optional(Schema.String),
  }),
);

const DAY_MS = 86_400_000;
// Give settle scripts time to open terminals that protect the worktree.
const SETTLE_SCRIPT_GRACE_MS = 60_000;
// Worktree creation can precede its thread row, including review-guide checkouts.
const ORPHAN_WORKTREE_GRACE_MS = 60 * 60 * 1_000;
// Personal build: files a removal would delete are backed up first.
/** Ignored paths inside directories that installs, builds, and tools regenerate, at any depth. */
const REBUILDABLE_IGNORED_PATH =
  /(^|\/)(node_modules|\.husky\/_|dist|\.astro|\.build|\.preview|supabase\/\.temp|tests\/browser\/\.artifacts)\//;
const MAX_COMPARED_FILE_BYTES = 8 * 1024 * 1024;
// Worktrees with more unique data than this are kept rather than backed up.
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_SCANNED_ENTRIES = 10_000;
const BACKUP_RETENTION_DAYS = 30;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const REPORT_ENTRY_LIMIT = 200;
const isGitCommandError = Schema.is(GitCommandError);
const isStorageWorktreeError = Schema.is(StorageWorktreeError);

function cleanupFailureReason(error: { readonly message: string }) {
  return isGitCommandError(error)
    ? `${error.command}: ${error.detail.split(/\r?\n/)[0]}${error.reason ? ` (${error.reason})` : ""}`
    : (error.message.split(/\r?\n/)[0] ?? error.message);
}

const worktreeCleanupEnabled = (rules: WorktreeCleanupRules) =>
  rules.worktreeAfterDays !== null ||
  rules.worktreeSettledAfterDays !== null ||
  rules.worktreeOnMerge ||
  rules.worktreeOnDelete ||
  rules.worktreeUnchanged;

function anyWorktreePolicy(
  settings: ServerSettings,
  predicate: (rules: WorktreeCleanupRules) => boolean,
): boolean {
  return (
    predicate(resolveWorktreeCleanup(settings, null)) ||
    Object.keys(settings.projectSettingsOverrides).some((projectId) =>
      predicate(resolveWorktreeCleanup(settings, projectId as ProjectId)),
    )
  );
}

function sameProjectWorktreePolicies(left: ServerSettings, right: ServerSettings): boolean {
  return [
    ...new Set([
      ...Object.keys(left.projectSettingsOverrides),
      ...Object.keys(right.projectSettingsOverrides),
    ]),
  ].every((projectId) =>
    Equal.equals(
      left.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
      right.projectSettingsOverrides[projectId as ProjectId]?.worktreeCleanup,
    ),
  );
}

export function storageCleanupThreadIdle(thread: OrchestrationV2ThreadShell, now: number): boolean {
  return (
    thread.worktreePath !== null &&
    thread.activeRunId === null &&
    (thread.status === "idle" ||
      thread.status === "completed" ||
      thread.status === "interrupted" ||
      thread.status === "failed" ||
      thread.status === "cancelled" ||
      thread.status === "rolled_back") &&
    (thread.pendingBackgroundTasks?.length ?? 0) === 0 &&
    thread.pendingRuntimeRequest === null &&
    !threadHasQueuedTurnStart(thread, now)
  );
}

/** PR metadata refreshes must not reset the inactivity clock. */
export function storageCleanupActivityAt(thread: OrchestrationV2ThreadShell): number {
  return Math.max(
    ...[
      thread.createdAt,
      thread.latestUserMessageAt,
      thread.latestRunRequestedAt,
      thread.latestRunStartedAt,
      thread.latestRunCompletedAt,
    ].flatMap((value) => (value == null ? [] : [DateTime.toEpochMillis(value)])),
  );
}

/** Only a complete subagent chain within this worktree shares ownership. */
function worktreeOwner<T extends Pick<OrchestrationV2ThreadShell, "id" | "lineage">>(
  threads: ReadonlyArray<T>,
) {
  if (threads.length === 1) return threads[0];
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const tops = threads.filter((thread) => !byId.has(thread.lineage.parentThreadId!));
  if (tops.length !== 1) return undefined;
  const owner = tops[0]!;
  for (const thread of threads) {
    let current = thread;
    const seen = new Set<string>();
    while (current.id !== owner.id) {
      if (
        seen.has(current.id) ||
        current.lineage.relationshipToParent !== "subagent" ||
        current.lineage.rootThreadId !== owner.lineage.rootThreadId
      )
        return undefined;
      seen.add(current.id);
      const parent = byId.get(current.lineage.parentThreadId!);
      if (parent === undefined) return undefined;
      current = parent;
    }
  }
  return owner;
}

/** Squash/rebase merges require the merged PR to name this exact head commit. */
export function storageCleanupPullRequestMerged(
  pullRequest: Pick<
    GitManager.GitBranchPullRequest,
    "state" | "headRef" | "baseRef" | "headSha"
  > | null,
  worktree: {
    readonly branch: string;
    readonly defaultBranch: string;
    readonly headSha: string;
    readonly integrated: boolean;
  },
): boolean {
  return (
    pullRequest?.state === "merged" &&
    (worktree.integrated ||
      (pullRequest.headRef === worktree.branch &&
        pullRequest.baseRef === worktree.defaultBranch &&
        pullRequest.headSha === worktree.headSha))
  );
}

/** Personal build: pull requests linked to the thread, by number. */
export function storageCleanupLinkedPullRequestNumbers(
  thread: Pick<
    OrchestrationV2ThreadShell,
    "pullRequests" | "branchPullRequest" | "linkedPullRequest"
  >,
): ReadonlySet<number> {
  return new Set([
    ...(thread.pullRequests ?? [])
      .filter((link) => link.source !== "stack-dismissed")
      .map((link) => link.number),
    ...(thread.branchPullRequest ? [thread.branchPullRequest.number] : []),
    ...(thread.linkedPullRequest ? [thread.linkedPullRequest.number] : []),
  ]);
}

export class StorageCleanup extends Context.Service<
  StorageCleanup,
  {
    readonly runNow: Effect.Effect<StorageCleanupReport, ServerSettingsError>;
    readonly latestReport: Effect.Effect<StorageCleanupReport | null>;
    readonly reports: Stream.Stream<StorageCleanupReport | null>;
    readonly drain: Effect.Effect<void>;
    // Personal build: the worktree list in Settings → Storage.
    readonly worktrees: Stream.Stream<StorageWorktreeList>;
    readonly freeWorktreePackages: (
      input: StorageWorktreeTarget,
    ) => Effect.Effect<StorageWorktreeFreeResult, StorageWorktreeError>;
    readonly deleteWorktree: (
      input: StorageWorktreeDeleteInput,
    ) => Effect.Effect<StorageWorktreeDeletePlan, StorageWorktreeError>;
  }
>()("t3/storageCleanup") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settingsService = yield* Settings.ServerSettingsService;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const sql = yield* SqlClient.SqlClient;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const gitManager = yield* GitManager.GitManager;
  const terminals = yield* TerminalManager.TerminalManager;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const worktreeBackupsDir = path.join(path.dirname(config.worktreesDir), "worktree-backups");
  const liveTerminals = new Map<string, Map<string, TerminalSummary>>();
  const orphanSizes = new Map<string, number | null>();
  const noteTerminal = (terminal: TerminalSummary) => {
    const threadTerminals =
      liveTerminals.get(terminal.threadId) ?? new Map<string, TerminalSummary>();
    threadTerminals.set(terminal.terminalId, terminal);
    liveTerminals.set(terminal.threadId, threadTerminals);
  };

  const isWindows = yield* HostProcess.isWindows;
  const pathKey = (target: string) => {
    const resolved = path.resolve(target);
    return isWindows ? resolved.toLowerCase() : resolved;
  };
  const inside = (root: string, target: string) => {
    const relative = path.relative(pathKey(root), pathKey(target));
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  };
  const hasTerminal = (worktreePath: string) =>
    [...liveTerminals.values()]
      .flatMap((entries) => [...entries.values()])
      .some((terminal) => {
        if (terminal.status !== "starting" && terminal.status !== "running") return false;
        const cwd = path.resolve(terminal.cwd);
        return (
          (terminal.worktreePath !== null &&
            path.resolve(terminal.worktreePath) === worktreePath) ||
          cwd === worktreePath ||
          inside(worktreePath, cwd)
        );
      });

  // pnpm imports packages by clone or reflink when its store shares a device
  // with the worktree. Those files have one link but share blocks with the
  // store, so removing them frees almost nothing. A store on another device
  // forces real copies, which still count.
  const sharedPnpmVirtualStore = Effect.fnUntraced(
    function* (root: string) {
      const nodeModules = path.join(root, "node_modules");
      const text = yield* fs.readFileString(path.join(nodeModules, ".modules.yaml"));
      const manifest = yield* decodePnpmModulesManifest(yield* Effect.try(() => parseYaml(text)));
      // An agent can write this manifest, and statting a network path makes
      // Windows sign in to its host with the user's NTLM credentials.
      if (isNetworkPath(manifest.storeDir) || isNetworkPath(manifest.virtualStoreDir ?? "")) {
        return null;
      }
      const virtualStore = path.resolve(nodeModules, manifest.virtualStoreDir ?? ".pnpm");
      const [store, virtual] = yield* Effect.all([
        fs.stat(manifest.storeDir),
        fs.stat(virtualStore),
      ]);
      return store.dev === virtual.dev ? virtualStore : null;
    },
    Effect.orElseSucceed(() => null),
  );

  // Personal build: also sums rebuildable folders (packages) for the Storage
  // list. Untraced: its callers own the span.
  const measureTree = Effect.fnUntraced(function* (worktreePath: string) {
    const root = yield* fs.realPath(worktreePath);
    const skipped = yield* sharedPnpmVirtualStore(root);
    const pending: Array<[string, boolean]> = [[root, false]];
    let entries = 1;
    let bytes = 0;
    let packageBytes = 0;
    while (pending.length > 0) {
      const [target, inPackages] = pending.pop()!;
      if (target === skipped) continue;
      // Effect's stat follows links. Probe with readLink first to get lstat
      // semantics, including skipping dangling links and directory links.
      const isLink = yield* fs.readLink(target).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) =>
            error.cause instanceof Error && "code" in error.cause && error.cause.code === "EINVAL",
          () => Effect.succeed(false),
        ),
      );
      if (isLink) continue;
      if ((yield* fs.realPath(target)) !== target) return null;
      const stat = yield* fs.stat(target);
      if (stat.type === "File") {
        // Removing a shared hardlink leaves its blocks allocated.
        if (Option.getOrElse(stat.nlink, () => 1n) !== 1n) continue;
        const size = Option.match(stat.blocks, {
          onNone: () => Number(stat.size),
          onSome: (blocks) => Number(blocks * 512n),
        });
        bytes += size;
        if (inPackages) packageBytes += size;
      } else if (stat.type === "Directory") {
        const names = yield* fs.readDirectory(target);
        entries += names.length;
        if (entries > 2_000_000) return null;
        for (const name of names) {
          const child = path.join(target, name);
          if (!inside(root, child)) return null;
          pending.push([
            child,
            inPackages ||
              REBUILDABLE_IGNORED_PATH.test(`${path.relative(root, child).replaceAll("\\", "/")}/`),
          ]);
        }
      }
    }
    return { bytes, packageBytes };
  });
  const measureWorktree = Effect.fn("storageCleanup.measureWorktree")(
    function* (worktreePath: string) {
      return (yield* measureTree(worktreePath))?.bytes ?? null;
    },
    Effect.timeout("30 seconds"),
    Effect.orElseSucceed(() => null),
  );

  // Large snapshots take seconds; use the reader worker instead of blocking the event loop.
  const readThreads = Effect.fn("StorageCleanup.readThreads")(function* () {
    const snapshot = yield* projections.getShellSnapshot().pipe(NodeSqliteClient.readOnly);
    const projects = yield* projectStore.listShells();
    return { projects, threads: [...snapshot.threads, ...snapshot.archivedThreads] };
  });

  const containsProjectRoot = Effect.fn("StorageCleanup.containsProjectRoot")(function* (
    worktreePath: string,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
  ) {
    for (const project of projects) {
      const projectPath = path.resolve(project.workspaceRoot);
      if (pathKey(projectPath) === pathKey(worktreePath) || inside(worktreePath, projectPath))
        return true;
      const realPath = yield* fs
        .realPath(projectPath)
        .pipe(Effect.orElseSucceed(() => projectPath));
      if (pathKey(realPath) === pathKey(worktreePath) || inside(worktreePath, realPath))
        return true;
    }
    return false;
  });

  const reportOrphanWorktrees = Effect.fn("StorageCleanup.reportOrphanWorktrees")(function* (
    roots: ReadonlyArray<string>,
    projects: ReadonlyArray<{ readonly workspaceRoot: string }>,
    entries: StorageCleanupReportEntry[],
  ) {
    const rows = yield* sql<{ worktreePath: string }>`
      SELECT DISTINCT json_extract(payload_json, '$.worktreePath') AS "worktreePath"
      FROM orchestration_v2_projection_threads
      WHERE json_extract(payload_json, '$.worktreePath') IS NOT NULL
    `.pipe(NodeSqliteClient.readOnly);
    const referenced = new Set<string>();
    for (const row of rows) {
      const resolved = path.resolve(row.worktreePath);
      referenced.add(pathKey(resolved));
      referenced.add(
        pathKey(yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved))),
      );
    }
    const referencedAncestors = new Set<string>();
    for (let ancestor of referenced) {
      while (roots.some((root) => inside(root, ancestor))) {
        ancestor = pathKey(path.dirname(ancestor));
        referencedAncestors.add(ancestor);
      }
    }
    const projectRoots = (yield* Effect.forEach(
      yield* Effect.filter(projects, (project) =>
        fs.exists(path.resolve(project.workspaceRoot)).pipe(Effect.orElseSucceed(() => true)),
      ),
      (project) => {
        const resolved = path.resolve(project.workspaceRoot);
        return fs.realPath(resolved).pipe(
          Effect.orElseSucceed(() => resolved),
          Effect.map((realPath) => [resolved, realPath]),
        );
      },
    )).flat();
    const inProject = (target: string, managedRoot: string) =>
      projectRoots.some(
        (root) =>
          !inside(root, managedRoot) && (pathKey(root) === pathKey(target) || inside(root, target)),
      );
    const directories = Effect.fnUntraced(function* (parent: string, managedRoot: string) {
      if (inProject(parent, managedRoot)) return [];
      const result: string[] = [];
      for (const name of yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))) {
        const target = path.join(parent, name);
        if (!inside(parent, target) || inProject(target, managedRoot)) continue;
        const directory = yield* Effect.gen(function* () {
          if (pathKey(yield* fs.realPath(target)) !== pathKey(target)) return false;
          return (yield* fs.stat(target)).type === "Directory";
        }).pipe(Effect.orElseSucceed(() => false));
        if (directory) result.push(target);
      }
      return result;
    });
    // Let the first walk time out and cache unmeasurable folders; later walks share the remaining budget.
    const now = yield* Clock.currentTimeMillis;
    const measurementDeadline = now + 30_000;
    let firstMeasurement = true;
    const reported = new Set<string>();
    const report = Effect.fnUntraced(
      function* (worktreePath: string) {
        const key = pathKey(worktreePath);
        if (
          reported.has(key) ||
          referenced.has(key) ||
          referencedAncestors.has(key) ||
          projectRoots.some((root) => pathKey(root) === key || inside(worktreePath, root))
        )
          return;
        const modified = Option.getOrNull((yield* fs.stat(worktreePath)).mtime);
        if (modified !== null && modified.getTime() > now - ORPHAN_WORKTREE_GRACE_MS) return;
        const gitPath = path.join(worktreePath, ".git");
        const linked = (yield* fs.exists(gitPath)) && (yield* fs.stat(gitPath)).type === "File";
        reported.add(key);
        const remaining = measurementDeadline - (yield* Clock.currentTimeMillis);
        if (!orphanSizes.has(key) && (firstMeasurement || remaining > 0)) {
          const measured = yield* measureWorktree(worktreePath).pipe(
            firstMeasurement ? Effect.asSome : Effect.timeoutOption(remaining),
          );
          firstMeasurement = false;
          if (Option.isSome(measured)) orphanSizes.set(key, measured.value);
        }
        const bytes = orphanSizes.get(key) ?? null;
        entries.push({
          kind: "worktree",
          outcome: "kept",
          reason: linked
            ? "No thread uses this worktree"
            : "No thread uses this folder, and it isn't a git worktree",
          path: worktreePath,
          projectPath: null,
          threadId: null,
          threadTitle: null,
          bytes,
          files: null,
        });
      },
      Effect.orElseSucceed(() => undefined),
    );
    for (const root of roots) {
      // Worktrees can be <root>/<repository>/<branch> or explicitly <root>/<name>.
      for (const projectDirectory of yield* directories(root, root)) {
        yield* Effect.gen(function* () {
          if (referenced.has(pathKey(projectDirectory))) return;
          const gitPath = path.join(projectDirectory, ".git");
          if (yield* fs.exists(gitPath)) {
            if ((yield* fs.stat(gitPath)).type === "File") yield* report(projectDirectory);
            return;
          }
          for (const worktreePath of yield* directories(projectDirectory, root)) {
            yield* report(worktreePath);
          }
        }).pipe(Effect.orElseSucceed(() => undefined));
      }
    }
    for (const key of orphanSizes.keys()) {
      if (!reported.has(key)) orphanSizes.delete(key);
    }
  });

  // The branch checked out in cwd: null for a detached HEAD, undefined when cwd
  // is not a repository or is gone. Two small Git reads, since every worktree in
  // a sweep is asked; statusDetailsLocal also diffs and counts.
  const checkedOutBranch = Effect.fn("StorageCleanup.branchChanged")(function* (cwd: string) {
    const failure = (detail: string) =>
      new GitCommandError({
        operation: "StorageCleanup.branchChanged",
        command: "git",
        cwd,
        detail,
      });
    // Return null for missing/non-repository cwd; force untranslated git diagnostics for matching.
    const read = Effect.fnUntraced(function* (args: string[], allowedExitCode?: number) {
      const result = yield* git
        .execute({
          operation: "StorageCleanup.branchChanged",
          cwd,
          args,
          env: { LC_ALL: "C" },
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.catch((error) =>
            Effect.flatMap(fs.exists(cwd), (exists) =>
              exists ? Effect.fail(error) : Effect.succeed(null),
            ),
          ),
        );
      if (result === null) return null;
      if (result.exitCode === 0 || result.exitCode === allowedExitCode) return result;
      if (result.stderr.toLowerCase().includes("not a git repository")) return null;
      return yield* failure(
        result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      );
    });
    const index = yield* read(["rev-parse", "--git-path", "index"]);
    if (index === null) return undefined;
    if (yield* fs.exists(`${path.resolve(cwd, index.stdout.trim())}.lock`))
      return yield* failure(
        "Git index is locked. Status will resume when the index lock is removed.",
      );
    // Detached HEAD exits 1; full refs avoid shortening when a tag shares the branch name.
    const head = yield* read(["symbolic-ref", "--quiet", "HEAD"], 1);
    if (head === null) return undefined;
    const ref = head.exitCode === 0 ? head.stdout.trim() : "";
    const name = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length).trim() : null;
    return name?.startsWith("(") ? null : name;
  });
  const branchChanged = (cwd: string, branch: string | null) =>
    checkedOutBranch(cwd).pipe(
      Effect.map((current) => current === undefined || current !== branch),
    );

  const localChangesReason = Effect.fn("StorageCleanup.localChangesReason")(function* (
    cwd: string,
    rules: WorktreeCleanupRules,
  ) {
    const status = yield* git.execute({
      operation: "StorageCleanup.localChanges",
      cwd,
      args: [
        "status",
        "--porcelain=v1",
        "-z",
        "--ignore-submodules=none",
        rules.worktreeKeepWhen === "tracked-changes"
          ? "--untracked-files=no"
          : "--untracked-files=all",
      ],
      maxOutputBytes: 64 * 1024,
    });
    if (status.stdoutTruncated) return "local changes exceed the inspection limit";
    const records = status.stdout.split("\0").filter(Boolean);
    let count = 0;
    for (let i = 0; i < records.length; i++) {
      count++;
      if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
    }
    if (count > 0) return `has uncommitted changes (${count} ${count === 1 ? "file" : "files"})`;
    if (rules.worktreeKeepWhen !== "any-local-files") return null;
    const ignored = yield* git.execute({
      operation: "StorageCleanup.ignoredFiles",
      cwd,
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      maxOutputBytes: 64 * 1024,
    });
    if (ignored.stdoutTruncated) return "ignored files exceed the inspection limit";
    const file = ignored.stdout
      .split("\0")
      .find((entry) => entry !== "" && !/(^|\/)node_modules\/$/.test(entry));
    return file === undefined ? null : `has ignored files (${file})`;
  });

  const submoduleRemoval = Effect.fn("StorageCleanup.submoduleRemoval")(
    function* (cwd: string, rules: WorktreeCleanupRules) {
      const inspect = (args: string[], maxOutputBytes = 64 * 1024) =>
        git.execute({
          operation: "StorageCleanup.submodules",
          cwd,
          args,
          maxOutputBytes,
        });
      const admin = yield* inspect(["rev-parse", "--absolute-git-dir"]);
      if (admin.stdoutTruncated || admin.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const modules = path.join(admin.stdout.replace(/\n$/, ""), "modules");
      const stored = yield* fs.exists(modules);
      if (!stored && !(yield* fs.exists(path.join(cwd, ".gitmodules"))))
        return { force: false, reason: null };
      const populated = yield* inspect([
        "submodule",
        "foreach",
        "--recursive",
        "--quiet",
        'printf "%s\\0" "$toplevel/$sm_path"',
      ]);
      if (populated.stdoutTruncated || populated.stderrTruncated)
        return { force: false, reason: "submodule inspection exceeded the limit" };
      const paths = populated.stdout.split("\0").filter(Boolean);
      const pending = [modules];
      for (const submodule of paths) {
        const directory = yield* inspect(["-C", submodule, "rev-parse", "--absolute-git-dir"]);
        if (directory.stdoutTruncated || directory.stderrTruncated)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        pending.push(directory.stdout.replace(/\n$/, ""));
      }
      const visited = new Set<string>();
      while (pending.length > 0) {
        const directory = pending.pop()!;
        if (!(yield* fs.exists(directory))) continue;
        const canonical = yield* fs.realPath(directory);
        if (visited.has(canonical)) continue;
        visited.add(canonical);
        if (visited.size > 10_000)
          return { force: false, reason: "submodule inspection exceeded the limit" };
        if ((yield* fs.stat(directory)).type !== "Directory")
          return { force: false, reason: "submodule repository could not be inspected" };
        if (yield* fs.exists(path.join(directory, "HEAD"))) {
          const unpushed = yield* inspect([
            "--git-dir",
            directory,
            "--work-tree",
            cwd,
            "rev-list",
            "--max-count=1",
            "HEAD",
            "--all",
            "--reflog",
            "--not",
            "--remotes",
          ]);
          if (unpushed.stdoutTruncated || unpushed.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          if (unpushed.stdout.trim() !== "")
            return { force: false, reason: "submodule has commits not on a remote-tracking ref" };
          pending.push(path.join(directory, "modules"));
        } else {
          for (const name of yield* fs.readDirectory(directory))
            pending.push(path.join(directory, name));
        }
      }
      // Check files after walking stored history to shorten the gap before forced removal.
      for (const submodule of paths) {
        const changes = yield* localChangesReason(submodule, rules);
        if (changes !== null) return { force: false, reason: `submodule ${changes}` };
      }
      const force = stored || paths.length > 0;
      if (force && rules.worktreeKeepWhen !== "tracked-changes") {
        const root = yield* fs.realPath(cwd);
        // Git status and foreach omit files inside deinitialized gitlink directories.
        const populatedPaths = new Set(paths.map(pathKey));
        const unchecked: string[] = [];
        for (const repository of [root, ...paths]) {
          const index = yield* inspect(
            ["-C", repository, "ls-files", "--stage", "-z"],
            16 * 1024 * 1024,
          );
          if (index.stdoutTruncated || index.stderrTruncated)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          for (const entry of index.stdout.split("\0")) {
            if (!entry.startsWith("160000 ")) continue;
            const submodule = path.resolve(repository, entry.slice(entry.indexOf("\t") + 1));
            if (!inside(root, submodule))
              return { force: false, reason: "submodules could not be inspected" };
            if (!populatedPaths.has(pathKey(submodule)) && (yield* fs.exists(submodule)))
              unchecked.push(submodule);
          }
        }
        let inspected = unchecked.length;
        while (unchecked.length > 0) {
          if (inspected > 10_000)
            return { force: false, reason: "submodule inspection exceeded the limit" };
          const target = unchecked.pop()!;
          if (
            (yield* fs.realPath(target)) !== path.resolve(target) ||
            (yield* fs.stat(target)).type !== "Directory"
          )
            return { force: false, reason: "submodule has local files" };
          if (path.basename(target) === "node_modules") continue;
          const names = yield* fs.readDirectory(target);
          inspected += names.length;
          for (const name of names) unchecked.push(path.join(target, name));
        }
      }
      return { force, reason: null };
    },
    Effect.orElseSucceed(() => ({ force: false, reason: "submodules could not be inspected" })),
  );

  const cleanupGit = Effect.fn("StorageCleanup.cleanupGit")(function* (
    cwd: string,
    args: string[],
    command: string,
  ) {
    const result = yield* git.execute({
      operation: "StorageCleanup.cleanupGit",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 300_000,
    });
    if (result.exitCode !== 0)
      return yield* new GitCommandError({
        operation: "StorageCleanup.cleanupGit",
        command,
        cwd,
        detail: result.stderr.trim().split(/\r?\n/)[0]?.slice(0, 1000) || "command failed",
      });
  });

  const isSymlink = (target: string) =>
    fs.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  // True when the worktree file is a byte-identical copy of the main checkout's
  // file at the same relative path, such as an env file copied in at setup.
  const sameAsMainCheckout = Effect.fn("StorageCleanup.sameAsMainCheckout")(
    function* (worktreePath: string, workspaceRoot: string, relative: string) {
      const copy = path.join(worktreePath, relative);
      const original = path.join(workspaceRoot, relative);
      // An original that resolves into this worktree would be removed with it.
      const originalReal = yield* fs.realPath(original);
      if (originalReal === worktreePath || inside(worktreePath, originalReal)) return false;
      const [copyInfo, originalInfo] = yield* Effect.all([fs.stat(copy), fs.stat(original)]);
      if (
        copyInfo.type !== "File" ||
        originalInfo.type !== "File" ||
        copyInfo.size !== originalInfo.size ||
        Number(copyInfo.size) > MAX_COMPARED_FILE_BYTES
      )
        return false;
      const [copyBytes, originalBytes] = yield* Effect.all([
        fs.readFile(copy),
        fs.readFile(original),
      ]);
      return Buffer.from(copyBytes).equals(originalBytes);
    },
    Effect.orElseSucceed(() => false),
  );

  /**
   * Files a removal would delete that exist nowhere else: untracked and ignored
   * files, minus rebuildable paths and identical copies of the main checkout.
   * Null when there is too much to back up.
   */
  const uniqueFiles = Effect.fn("StorageCleanup.uniqueFiles")(function* (
    worktreePath: string,
    workspaceRoot: string,
  ) {
    const listGit = (operation: string, args: ReadonlyArray<string>) =>
      git.execute({ operation, cwd: worktreePath, args, maxOutputBytes: 1024 * 1024 });
    const ignored = yield* listGit("StorageCleanup.ignoredFiles", [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]);
    const untracked = yield* listGit("StorageCleanup.untrackedFiles", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    if (ignored.stdoutTruncated || untracked.stdoutTruncated) return null;
    const entries: string[] = untracked.stdout.split("\0").filter(Boolean);
    for (const entry of ignored.stdout.split("\0")) {
      if (entry === "" || REBUILDABLE_IGNORED_PATH.test(entry)) continue;
      // A symlinked node_modules is listed without a trailing slash.
      if (/(^|\/)node_modules$/.test(entry) && (yield* isSymlink(path.join(worktreePath, entry))))
        continue;
      entries.push(entry);
    }
    const root = path.resolve(workspaceRoot);
    const files: string[] = [];
    let scanned = 0;
    let bytes = 0;
    const visit = Effect.fn("StorageCleanup.visitUniqueFile")(function* (
      relative: string,
    ): Effect.fn.Return<boolean, PlatformError> {
      if (++scanned > MAX_SCANNED_ENTRIES) return false;
      const target = path.join(worktreePath, relative);
      // Removing a symlink loses nothing.
      if (!(yield* fs.exists(target)) || (yield* isSymlink(target))) return true;
      const info = yield* fs.stat(target);
      if (info.type === "Directory") {
        if (REBUILDABLE_IGNORED_PATH.test(`${relative}/`)) return true;
        // Git lists paths with forward slashes on every platform.
        for (const child of yield* fs.readDirectory(target))
          if (!(yield* visit(`${relative.replace(/\/+$/, "")}/${child}`))) return false;
        return true;
      }
      if (yield* sameAsMainCheckout(worktreePath, root, relative)) return true;
      bytes += Number(info.size);
      files.push(relative);
      return bytes <= MAX_BACKUP_BYTES;
    });
    for (const entry of new Set(entries)) if (!(yield* visit(entry))) return null;
    return files;
  });

  // Copies files into a dated folder under worktree-backups, mirroring their
  // place in the worktree, so they can be restored by hand. A worktree that
  // already has a backup reuses it: when removal keeps failing (Windows locks
  // open files), each hourly sweep would otherwise add another full copy.
  const backUp = Effect.fn("StorageCleanup.backUp")(function* (
    worktreePath: string,
    relativeWorktree: string,
    files: ReadonlyArray<string>,
    now: number,
  ) {
    const parent = path.join(worktreeBackupsDir, path.dirname(relativeWorktree));
    const backupName = new RegExp(
      `^${path.basename(relativeWorktree).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}(-\\d{2}){4}$`,
    );
    const previous = (yield* fs.exists(parent))
      ? (yield* fs.readDirectory(parent))
          .filter((name) => backupName.test(name))
          .toSorted()
          .at(-1)
      : undefined;
    const stamp = DateTime.formatIso(DateTime.makeUnsafe(now)).slice(0, 16).replace(/[:T]/g, "-");
    const destination =
      previous === undefined
        ? path.join(worktreeBackupsDir, `${relativeWorktree}-${stamp}`)
        : path.join(parent, previous);
    for (const file of files) {
      const target = path.join(destination, file);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      yield* fs.copyFile(path.join(worktreePath, file), target);
    }
    // Retention counts from the last write, not the first backup. Node reads
    // numeric times as seconds.
    yield* fs.utimes(destination, now / 1000, now / 1000);
    return destination;
  });

  const cleanBackups = Effect.fn("StorageCleanup.cleanBackups")(function* (now: number) {
    if (!(yield* fs.exists(worktreeBackupsDir))) return;
    // Only the folder itself must not be a link; T3 home may sit under one.
    if (yield* isSymlink(worktreeBackupsDir)) return;
    const realRoot = yield* fs.realPath(worktreeBackupsDir);
    for (const project of yield* fs.readDirectory(realRoot)) {
      const projectDir = path.join(realRoot, project);
      if ((yield* fs.realPath(projectDir)) !== projectDir) continue;
      if ((yield* fs.stat(projectDir)).type !== "Directory") continue;
      for (const backup of yield* fs.readDirectory(projectDir)) {
        const target = path.join(projectDir, backup);
        if ((yield* fs.realPath(target)) !== target) continue;
        const modified = Option.getOrNull((yield* fs.stat(target)).mtime);
        if (modified !== null && modified.getTime() < now - BACKUP_RETENTION_DAYS * DAY_MS)
          yield* fs.remove(target, { recursive: true });
      }
    }
  });

  const liveSessionInside = Effect.fn("StorageCleanup.liveSessionInside")(function* (
    worktreePath: string,
  ) {
    // Sessions can outlive their run and can be shared across app threads.
    const sessionRows = yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM orchestration_v2_projection_provider_sessions
      WHERE status != 'stopped'
    `;
    const sessions = yield* Effect.forEach(sessionRows, (row) =>
      decodeCleanupSession(row.payload_json),
    );
    // A stored session can stay ready after its runtime was released,
    // for example once every thread detached; only a live one holds it.
    for (const session of sessions) {
      const cwd = path.resolve(session.cwd);
      if (
        (cwd === worktreePath || inside(worktreePath, cwd)) &&
        (yield* providerSessions.isLive(session.id))
      )
        return true;
    }
    return false;
  });

  const managedRoots = Effect.fn("StorageCleanup.managedRoots")(function* (
    serverSettings: ServerSettings,
  ) {
    const roots: Array<string> = [];
    for (const directory of managedWorktreesDirectories(
      serverSettings,
      config.worktreesDir,
      path,
      yield* HostProcess.HomeDirectory,
    )) {
      const root = yield* fs.exists(directory).pipe(
        Effect.flatMap((exists) => (exists ? fs.realPath(directory) : Effect.succeed(null))),
        Effect.orElseSucceed(() => null),
      );
      if (root !== null && !isFilesystemRoot(root, path)) roots.push(root);
    }
    return roots;
  });

  const cleanWorktrees = Effect.fn("StorageCleanup.cleanWorktrees")(function* (
    serverSettings: ServerSettings,
    now: number,
    entries: StorageCleanupReportEntry[],
  ) {
    if (!anyWorktreePolicy(serverSettings, worktreeCleanupEnabled)) return;
    const roots = yield* managedRoots(serverSettings);
    const deletedRows = yield* sql<{ payload_json: string; workspaceRoot: string }>`
          SELECT t.payload_json, p.workspace_root AS "workspaceRoot"
          FROM orchestration_v2_projection_threads t
          JOIN projection_projects p ON p.project_id = t.project_id
          WHERE t.deleted_at IS NOT NULL
        `.pipe(NodeSqliteClient.readOnly);
    const deletedThreads = (yield* Effect.forEach(deletedRows, (row) =>
      decodeCleanupThread(row.payload_json).pipe(
        Effect.map((thread) => ({ ...thread, workspaceRoot: row.workspaceRoot })),
      ),
    )).filter((thread) => thread.worktreePath !== null && thread.branch !== null);
    const snapshot = yield* readThreads();
    const refreshedDefaultRefs = new Map<string, Set<string>>();
    const defaultBranches = new Map<string, string | null>();
    const groups = Map.groupBy(
      snapshot.threads.filter((thread) => thread.worktreePath !== null),
      (thread) => path.resolve(thread.worktreePath!),
    );
    const deletedByPath = Map.groupBy(deletedThreads, (thread) =>
      path.resolve(thread.worktreePath!),
    );
    const candidates = [
      ...[...groups].map(
        ([worktreePath, group]) =>
          // A deleted thread still owns the worktree its remaining subagents share,
          // but only deletion cleanup acts on it; otherwise the live rules apply.
          deletedByPath
            .get(worktreePath)
            ?.find(
              (deleted) =>
                resolveWorktreeCleanup(serverSettings, deleted.projectId).worktreeOnDelete &&
                worktreeOwner([deleted, ...group]) === deleted,
            ) ??
          worktreeOwner(group) ??
          group[0]!,
      ),
      ...deletedThreads.filter((thread) => !groups.has(path.resolve(thread.worktreePath!))),
    ];
    for (const thread of candidates) {
      const settings = resolveWorktreeCleanup(serverSettings, thread.projectId);
      if (!worktreeCleanupEnabled(settings)) continue;
      const worktreePath = path.resolve(thread.worktreePath!);
      const group = groups.get(worktreePath) ?? [];
      const activityAt = Math.max(...group.map(storageCleanupActivityAt));
      const deleted = "workspaceRoot" in thread;
      const members = deleted ? [thread, ...group] : group;
      const project = deleted
        ? { workspaceRoot: thread.workspaceRoot }
        : snapshot.projects.find((entry) => entry.id === thread.projectId);
      const entry: StorageCleanupReportEntry = {
        kind: "worktree",
        outcome: "kept",
        reason: "",
        path: worktreePath,
        projectPath: project?.workspaceRoot ?? null,
        threadId: thread.id,
        threadTitle: thread.title,
        bytes: null,
        files: null,
      };
      const keep = (reason: string) => entries.push({ ...entry, reason: sentence(reason) });
      yield* Effect.gen(function* () {
        if (!(yield* fs.exists(worktreePath))) return;
        if (deleted && !settings.worktreeOnDelete) return keep("no rules apply");
        if (members.length > 1 && worktreeOwner(members) === undefined)
          return keep(`shared by ${members.length} threads`);
        if (project === undefined) return keep("project is unavailable");
        if (
          thread.branch === null ||
          !group.every((member) => storageCleanupThreadIdle(member, now))
        )
          return keep("thread is running or has pending work");
        if (group.some((member) => member.branch !== thread.branch))
          return keep("a subagent thread's branch differs from this worktree's branch");
        if (hasTerminal(worktreePath)) return keep("open terminal");
        // Compare canonical roots while allowing symlinked parents, never symlinked worktree directories.
        const realPath = yield* fs.realPath(worktreePath);
        const realParent = yield* fs.realPath(path.dirname(worktreePath));
        if (realPath !== path.join(realParent, path.basename(worktreePath)))
          return keep("worktree is a symbolic link");
        if (!roots.some((root) => inside(root, realPath)))
          return keep("outside the managed worktree folder");
        if (yield* containsProjectRoot(worktreePath, [project, ...snapshot.projects]))
          return keep("contains a project checkout");
        if ((yield* fs.stat(path.join(worktreePath, ".git"))).type !== "File")
          return keep("not a linked worktree");
        // Personal build: agents often open their pull request from a new
        // branch. A switch to a branch with a pull request linked to the thread
        // can still be removed once that pull request is merged.
        const checkedOut = yield* checkedOutBranch(worktreePath);
        const switchedBranch =
          checkedOut !== thread.branch &&
          typeof checkedOut === "string" &&
          storageCleanupLinkedPullRequestNumbers(thread).size > 0
            ? checkedOut
            : null;
        if (checkedOut !== thread.branch && switchedBranch === null)
          return keep(
            typeof checkedOut === "string"
              ? `branch switched to ${checkedOut}`
              : "repository or branch changed",
          );
        const worktreeBranch = switchedBranch ?? thread.branch;
        const changes = yield* localChangesReason(worktreePath, settings);
        if (changes !== null) return keep(changes);
        if (
          group.some(
            (member) =>
              member.settledAt !== null &&
              now - Math.max(DateTime.toEpochMillis(member.updatedAt), activityAt) <
                SETTLE_SCRIPT_GRACE_MS,
          )
        )
          return keep("settled moments ago");
        const head = yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" });
        const old =
          !deleted &&
          settings.worktreeAfterDays !== null &&
          activityAt < now - settings.worktreeAfterDays * DAY_MS;
        const settledFor =
          deleted || thread.settledAt === null
            ? null
            : now - Math.max(DateTime.toEpochMillis(thread.settledAt), activityAt);
        const settledDays = settledFor === null ? null : Math.floor(settledFor / DAY_MS);
        const settled =
          settledFor !== null &&
          settings.worktreeSettledAfterDays !== null &&
          settledFor >= settings.worktreeSettledAfterDays * DAY_MS;
        let eligible = switchedBranch === null && (deleted || old || settled);
        let removalReason = deleted
          ? "thread was deleted"
          : old
            ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} days`
            : `settled for ${settledDays} days`;
        if (!eligible && (settings.worktreeUnchanged || settings.worktreeOnMerge)) {
          const repositoryCwd = path.resolve(project.workspaceRoot);
          const remote = yield* git.resolvePrimaryRemoteName(repositoryCwd);
          const defaultBranchKey = `${repositoryCwd}\0${remote}`;
          let branch = defaultBranches.get(defaultBranchKey);
          if (branch === undefined) {
            branch = yield* git.resolveDefaultBranchName(repositoryCwd, remote);
            // Without a local HEAD ref, only the remote can identify its default;
            // a conventional name may be a feature branch.
            if (branch === null) {
              branch = yield* git
                .execute({
                  operation: "StorageCleanup.resolveDefaultBranch",
                  cwd: repositoryCwd,
                  args: ["ls-remote", "--symref", "--", remote, "HEAD"],
                  timeoutMs: 20_000,
                })
                .pipe(
                  Effect.map(
                    (result) =>
                      /^ref: refs\/heads\/(.+)\tHEAD\r?$/m.exec(result.stdout)?.[1] ?? null,
                  ),
                  Effect.orElseSucceed(() => null),
                );
            }
            defaultBranches.set(defaultBranchKey, branch);
          }
          if (branch === null) return keep("default branch is unavailable");
          const defaultRef = `refs/remotes/${remote}/${branch}`;
          const refreshed = refreshedDefaultRefs.get(repositoryCwd) ?? new Set<string>();
          if (!refreshed.has(defaultRef)) {
            yield* git.fetchRemoteTrackingBranch({
              cwd: repositoryCwd,
              remoteName: remote,
              remoteBranch: branch,
            });
            refreshed.add(defaultRef);
            refreshedDefaultRefs.set(repositoryCwd, refreshed);
          }
          const base = yield* git.resolveCommit({
            cwd: worktreePath,
            revision: defaultRef,
          });
          const ancestor = yield* git.execute({
            operation: "StorageCleanup.integratedBranch",
            cwd: worktreePath,
            args: ["merge-base", "--is-ancestor", head.commitSha, base.commitSha],
            allowNonZeroExit: true,
          });
          const integrated = ancestor.exitCode === 0;
          eligible = integrated && settings.worktreeUnchanged;
          if (eligible) removalReason = "no commits beyond the default branch";
          if (!eligible && settings.worktreeOnMerge) {
            const pullRequest = yield* gitManager.branchPullRequest(
              { cwd: worktreePath, branch: worktreeBranch },
              { refresh: true },
            );
            eligible =
              (switchedBranch === null ||
                (pullRequest !== null &&
                  storageCleanupLinkedPullRequestNumbers(thread).has(pullRequest.number))) &&
              storageCleanupPullRequestMerged(pullRequest, {
                branch: worktreeBranch,
                defaultBranch: branch,
                headSha: head.commitSha,
                integrated,
              });
            if (eligible) removalReason = "pull request was merged";
          }
        }
        if (!eligible)
          return keep(
            switchedBranch !== null
              ? `branch switched to ${switchedBranch}`
              : !deleted && settings.worktreeAfterDays !== null
                ? `inactive for ${Math.floor((now - activityAt) / DAY_MS)} of ${settings.worktreeAfterDays} days`
                : settings.worktreeSettledAfterDays !== null
                  ? settledFor === null
                    ? "not settled"
                    : `settled for ${settledDays} of ${settings.worktreeSettledAfterDays} days`
                  : settings.worktreeOnMerge
                    ? "not merged"
                    : "has commits beyond the default branch",
          );
        // Re-read this path's threads and sessions so new activity cancels removal; full per-worktree snapshots take seconds.
        const blockedSinceCheck = Effect.fnUntraced(function* () {
          const latestProjects = yield* projectStore.listShells();
          if (yield* containsProjectRoot(worktreePath, [project, ...latestProjects]))
            return "contains a project checkout";
          const latest = (yield* projections.getThreadWorktreePaths({
            includeArchived: true,
          })).filter((entry) => path.resolve(entry.worktreePath) === worktreePath);
          if (hasTerminal(worktreePath)) return "open terminal";
          if (deleted) {
            if (
              !resolveWorktreeCleanup(yield* settingsService.getSettings, thread.projectId)
                .worktreeOnDelete
            )
              return "thread or cleanup settings changed since check";
            // Durable deletion cleanup must succeed or be explicitly cancelled before removing its checkout.
            const pendingCleanup = yield* sql`
              SELECT 1 FROM orchestration_v2_effect_outbox
              WHERE thread_id = ${thread.id} AND status NOT IN ('succeeded', 'cancelled') LIMIT 1
            `.pipe(NodeSqliteClient.readOnly);
            if (pendingCleanup.length > 0) return "thread deletion is still pending";
          }
          const latestShells = yield* Effect.forEach(latest, (entry) =>
            projections.getThreadShell(entry.threadId),
          );
          const latestGroup = latestShells.filter((shell) => shell !== null);
          const latestOwner = worktreeOwner(deleted ? [thread, ...latestGroup] : latestGroup);
          if (
            latestGroup.length !== group.length ||
            latestOwner?.id !== thread.id ||
            latestOwner?.branch !== thread.branch ||
            latestGroup.some((shell) => {
              const previous = group.find((member) => member.id === shell.id);
              return (
                previous === undefined ||
                shell.branch !== thread.branch ||
                !Equal.equals(shell.settledAt, previous.settledAt) ||
                (shell.settledAt !== null && !Equal.equals(shell.updatedAt, previous.updatedAt)) ||
                !storageCleanupThreadIdle(shell, now) ||
                path.resolve(shell.worktreePath!) !== worktreePath ||
                storageCleanupActivityAt(shell) !== storageCleanupActivityAt(previous)
              );
            })
          )
            return "thread activity or shared worktree changed since check";
          return (yield* liveSessionInside(worktreePath)) ? "provider session is still open" : null;
        });
        const blocked = yield* blockedSinceCheck();
        if (blocked !== null) return keep(blocked);
        const bytes = yield* measureWorktree(worktreePath);
        const blockedWhileMeasuring = yield* blockedSinceCheck();
        if (blockedWhileMeasuring !== null) return keep(blockedWhileMeasuring);
        if (yield* branchChanged(worktreePath, worktreeBranch))
          return keep("repository or branch changed since check");
        if (
          (yield* git.resolveCommit({ cwd: worktreePath, revision: "HEAD" })).commitSha !==
          head.commitSha
        )
          return keep("commit changed since check");
        const finalChanges = yield* localChangesReason(worktreePath, settings);
        if (finalChanges !== null) return keep(finalChanges);
        const current = resolveWorktreeCleanup(
          yield* settingsService.getSettings,
          thread.projectId,
        );
        if (
          Object.keys(settings).some(
            (key) =>
              current[key as keyof typeof settings] !== settings[key as keyof typeof settings],
          )
        )
          return keep("settings changed since check");
        // Removal deletes ignored files, and in tracked-only mode untracked
        // files too. Back up the ones that exist nowhere else first; a failed
        // backup fails the removal.
        const files =
          settings.worktreeKeepWhen === "any-local-files"
            ? []
            : yield* uniqueFiles(worktreePath, project.workspaceRoot);
        if (files === null) return keep("too many local files to back up");
        const backupRoot = roots.find((root) => inside(root, realPath))!;
        const backup =
          files.length > 0
            ? yield* backUp(worktreePath, path.relative(backupRoot, realPath), files, now)
            : null;
        if (backup !== null)
          removalReason = `${removalReason}, ${files.length} local ${files.length === 1 ? "file" : "files"} backed up`;
        // Clean only untracked files; Git must still refuse removal if a tracked
        // edit arrives after our last status check.
        if (settings.worktreeKeepWhen === "tracked-changes")
          yield* cleanupGit(worktreePath, ["clean", "-ffdx"], "git clean");
        const submodules = yield* submoduleRemoval(worktreePath, settings);
        if (submodules.reason !== null) return keep(submodules.reason);
        if (submodules.force) {
          const changes = yield* localChangesReason(worktreePath, settings);
          if (changes !== null) return keep(changes);
        }
        yield* removeLinkedWorktree({
          operation: "StorageCleanup.cleanupGit",
          cwd: project.workspaceRoot,
          worktreePath,
          // Git requires force for submodules; recursive checks above cannot make removal atomic.
          force: submodules.force,
          execute: git.execute,
          run: (args) => cleanupGit(project.workspaceRoot, [...args], "git worktree remove"),
        });
        entries.push({ ...entry, outcome: "removed", reason: sentence(removalReason), bytes });
        yield* gitManager.invalidateStatus(project.workspaceRoot);
        // Preserve branch/path so ProviderTurnStartService can recreate the checkout on resume.
        yield* Effect.logInfo("storage cleanup removed worktree", { threadId: thread.id, backup });
      }).pipe(
        (effect) => withWorkspaceLease(worktreePath, effect),
        Effect.catch((error) =>
          Effect.gen(function* () {
            entries.push({
              ...entry,
              outcome: "failed",
              reason: cleanupFailureReason(error),
            });
            yield* Effect.logWarning("storage cleanup failed for worktree", {
              threadId: thread.id,
              error,
            });
          }),
        ),
      );
    }
    yield* reportOrphanWorktrees(
      roots,
      yield* projectStore.list({ includeDeleted: true }),
      entries,
    );
  });

  const cleanFiles = Effect.fn("StorageCleanup.cleanFiles")(function* (
    root: string,
    days: number | null,
    now: number,
    rotatedLogs: boolean,
    removed: { files: number; bytes: number },
  ) {
    if (days === null || !(yield* fs.exists(root))) return removed;
    const realRoot = yield* fs.realPath(root);
    if (realRoot !== path.resolve(root)) return removed;
    const visit = Effect.fn("StorageCleanup.visitFiles")(function* (
      directory: string,
    ): Effect.fn.Return<void, PlatformError | ServerSettingsError> {
      for (const name of yield* fs.readDirectory(directory)) {
        const target = path.join(directory, name);
        if ((yield* fs.realPath(target)) !== target || !inside(realRoot, target)) continue;
        const stat = yield* fs.stat(target);
        if (stat.type === "Directory" && rotatedLogs) {
          yield* visit(target);
        } else if (stat.type === "File" && (!rotatedLogs || /\.(?:log|ndjson)\.\d+$/.test(name))) {
          const modified = Option.getOrNull(stat.mtime);
          if (modified !== null && modified.getTime() < now - days * DAY_MS) {
            const current = (yield* settingsService.getSettings).storageCleanup;
            if ((rotatedLogs ? current.logsAfterDays : current.browserArtifactsAfterDays) !== days)
              return;
            yield* fs.remove(target);
            removed.files++;
            removed.bytes += Number(stat.size);
          }
        }
      }
    });
    yield* visit(realRoot);
    return removed;
  });

  // Personal build: the last report is saved, so the Storage page still shows
  // why each worktree was kept after a restart.
  const savedReportPath = path.join(path.dirname(config.dbPath), "storage-cleanup-report.json");
  const reportRef = yield* SubscriptionRef.make<StorageCleanupReport | null>(
    yield* fs.readFileString(savedReportPath).pipe(
      Effect.flatMap(decodeSavedReport),
      Effect.orElseSucceed(() => null),
    ),
  );
  const sweep = Effect.fn("StorageCleanup.sweep")(function* (
    trigger: StorageCleanupReport["trigger"],
  ) {
    const now = yield* Clock.currentTimeMillis;
    const serverSettings = yield* settingsService.getSettings;
    const settings = serverSettings.storageCleanup;
    const entries: StorageCleanupReportEntry[] = [];
    yield* cleanWorktrees(serverSettings, now, entries).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          entries.push({
            kind: "worktree",
            outcome: "failed",
            reason: cleanupFailureReason(error),
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: null,
            files: null,
          });
          yield* Effect.logWarning("worktree cleanup failed", { error });
        }),
      ),
    );
    for (const category of [
      {
        kind: "browser-artifacts" as const,
        root: config.browserArtifactsDir,
        days: settings.browserArtifactsAfterDays,
        label: "browser artifacts",
      },
      {
        kind: "logs" as const,
        root: config.logsDir,
        days: settings.logsAfterDays,
        label: "rotated logs",
      },
    ]) {
      if (category.days === null) continue;
      const removed = { files: 0, bytes: 0 };
      yield* cleanFiles(category.root, category.days, now, category.kind === "logs", removed).pipe(
        Effect.map(({ files, bytes }) =>
          entries.push({
            kind: category.kind,
            outcome: files > 0 ? "removed" : "kept",
            reason: files === 0 ? "No expired files" : `Removed ${files} ${category.label}`,
            path: null,
            projectPath: null,
            threadId: null,
            threadTitle: null,
            bytes: files > 0 ? bytes : null,
            files: files > 0 ? files : null,
          }),
        ),
        Effect.catch((error) =>
          Effect.gen(function* () {
            entries.push({
              kind: category.kind,
              outcome: "failed",
              reason: cleanupFailureReason(error),
              path: null,
              projectPath: null,
              threadId: null,
              threadTitle: null,
              bytes: removed.files > 0 ? removed.bytes : null,
              files: removed.files > 0 ? removed.files : null,
            });
            yield* Effect.logWarning("storage file cleanup failed", { kind: category.kind, error });
          }),
        ),
      );
    }
    yield* cleanBackups(now).pipe(
      Effect.catch((error) => Effect.logWarning("worktree backup cleanup failed", { error })),
    );
    const counts = { removed: 0, kept: 0, failed: 0 };
    let bytesFreed = 0;
    for (const entry of entries) {
      counts[entry.outcome]++;
      if (entry.outcome !== "kept") bytesFreed += entry.bytes ?? 0;
    }
    const priority = (entry: StorageCleanupReportEntry) =>
      entry.outcome === "failed"
        ? 0
        : entry.outcome === "removed"
          ? 1
          : entry.kind === "worktree" && entry.threadId === null
            ? 2
            : 3;
    const latestReport: StorageCleanupReport = {
      trigger,
      startedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      finishedAt: DateTime.formatIso(yield* DateTime.now),
      entries: entries.sort((a, b) => priority(a) - priority(b)).slice(0, REPORT_ENTRY_LIMIT),
      counts,
      bytesFreed,
      omittedCount: Math.max(0, entries.length - REPORT_ENTRY_LIMIT),
    };
    yield* SubscriptionRef.set(reportRef, latestReport);
    yield* encodeSavedReport(latestReport).pipe(
      Effect.flatMap((json) => fs.writeFileString(`${savedReportPath}.tmp`, json)),
      Effect.andThen(fs.rename(`${savedReportPath}.tmp`, savedReportPath)),
      Effect.catch((error) => Effect.logWarning("saving the cleanup report failed", { error })),
    );
    if ((yield* SubscriptionRef.get(worktreeListRef)) !== null) yield* requestWorktreeList(false);
    return latestReport;
  });
  const automaticSweepQueued = yield* Ref.make(false);
  const worker = yield* makeDrainableWorker(
    (completion: Deferred.Deferred<StorageCleanupReport, ServerSettingsError> | undefined) =>
      (completion === undefined ? Ref.set(automaticSweepQueued, false) : Effect.void).pipe(
        Effect.andThen(sweep(completion === undefined ? "automatic" : "manual")),
        Effect.exit,
        Effect.flatMap((exit) =>
          completion === undefined
            ? exit.pipe(
                Effect.asVoid,
                Effect.catchCause((cause) =>
                  Effect.logWarning("storage cleanup failed", { cause }),
                ),
              )
            : Deferred.done(completion, exit).pipe(Effect.asVoid),
        ),
      ),
  );
  const requestSweep = Ref.getAndSet(automaticSweepQueued, true).pipe(
    Effect.flatMap((queued) => (queued ? Effect.void : worker.enqueue(undefined))),
  );
  const runNow = Effect.gen(function* () {
    const completion = yield* Deferred.make<StorageCleanupReport, ServerSettingsError>();
    yield* worker.enqueue(completion);
    return yield* Deferred.await(completion);
  });

  // Personal build: Settings → Storage lists every folder in the worktree
  // directories, and can free a folder's packages or delete it by hand.
  const worktreeListRef = yield* SubscriptionRef.make<StorageWorktreeList | null>(null);
  const measuredSizes = new Map<
    string,
    { readonly bytes: number | null; readonly packageBytes: number | null; readonly at: number }
  >();
  const listRefresh = yield* Ref.make<"idle" | "running" | "queued">("idle");
  const remeasureStale = yield* Ref.make(false);
  const serviceScope = yield* Effect.scope;

  const worktreeFolders = Effect.fnUntraced(function* (roots: ReadonlyArray<string>) {
    const realDirectories = Effect.fnUntraced(function* (parent: string) {
      const result: string[] = [];
      for (const name of yield* fs.readDirectory(parent).pipe(Effect.orElseSucceed(() => []))) {
        const target = path.join(parent, name);
        const directory = yield* Effect.gen(function* () {
          if ((yield* fs.realPath(target)) !== target) return false;
          return (yield* fs.stat(target)).type === "Directory";
        }).pipe(Effect.orElseSucceed(() => false));
        if (directory) result.push(target);
      }
      return result;
    });
    const folders: string[] = [];
    // Worktrees are <root>/<repository>/<name>, or explicitly <root>/<name>.
    for (const root of roots)
      for (const parent of yield* realDirectories(root)) {
        if (yield* fs.exists(path.join(parent, ".git")).pipe(Effect.orElseSucceed(() => false)))
          folders.push(parent);
        else folders.push(...(yield* realDirectories(parent)));
      }
    return folders;
  });

  // The main checkout a linked worktree belongs to, from its `.git` file.
  const repositoryOfWorktree = Effect.fnUntraced(
    function* (worktreePath: string) {
      const text = yield* fs.readFileString(path.join(worktreePath, ".git"));
      const gitDirectory = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
      if (gitDirectory === undefined) return null;
      const common = path.dirname(path.dirname(path.resolve(worktreePath, gitDirectory)));
      return path.basename(common) === ".git" ? path.dirname(common) : common;
    },
    Effect.orElseSucceed(() => null),
  );

  const refreshWorktreeList = Effect.fn("StorageCleanup.refreshWorktreeList")(function* (
    remeasure: boolean,
  ) {
    const roots = yield* managedRoots(yield* settingsService.getSettings);
    const snapshot = yield* readThreads();
    const report = yield* SubscriptionRef.get(reportRef);
    const projectRoots = new Map<string, (typeof snapshot.projects)[number]>();
    for (const project of snapshot.projects) {
      const resolved = path.resolve(project.workspaceRoot);
      projectRoots.set(pathKey(resolved), project);
      const real = yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
      projectRoots.set(pathKey(real), project);
    }
    const threadsByPath = new Map<string, OrchestrationV2ThreadShell[]>();
    for (const thread of snapshot.threads) {
      if (thread.worktreePath === null) continue;
      const resolved = path.resolve(thread.worktreePath);
      const real = yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
      for (const key of new Set([pathKey(resolved), pathKey(real)])) {
        const group = threadsByPath.get(key) ?? [];
        group.push(thread);
        threadsByPath.set(key, group);
      }
    }
    const reportEntries = new Map(
      (report?.entries ?? []).flatMap((entry) =>
        entry.kind === "worktree" && entry.path !== null
          ? [[pathKey(entry.path), entry] as const]
          : [],
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    const entries: StorageWorktreeEntry[] = [];
    for (const folder of yield* worktreeFolders(roots)) {
      if (projectRoots.has(pathKey(folder))) continue;
      const key = pathKey(folder);
      const group = threadsByPath.get(key) ?? [];
      const thread = worktreeOwner(group) ?? group[0];
      const repository = thread === undefined ? yield* repositoryOfWorktree(folder) : null;
      const project =
        thread !== undefined
          ? snapshot.projects.find((entry) => entry.id === thread.projectId)
          : repository === null
            ? undefined
            : projectRoots.get(pathKey(repository));
      const links = (thread?.pullRequests ?? []).filter(
        (link) => link.source !== "stack-dismissed",
      );
      const link =
        links.findLast((entry) => entry.snapshot?.headBranch === thread?.branch) ?? links.at(-1);
      const linked = thread?.branchPullRequest ?? thread?.linkedPullRequest ?? null;
      const pullRequest = link
        ? { number: link.number, url: link.url, state: link.snapshot?.state ?? null }
        : linked
          ? { number: linked.number, url: linked.url, state: null }
          : null;
      const lastEntry = reportEntries.get(key);
      const size = measuredSizes.get(key);
      const stale = size !== undefined && remeasure && now - size.at > 60 * 60 * 1_000;
      if (stale) measuredSizes.delete(key);
      entries.push({
        path: folder,
        projectName:
          (project as { readonly title?: string } | undefined)?.title ??
          (repository === null ? path.basename(path.dirname(folder)) : path.basename(repository)),
        projectId: thread?.projectId ?? project?.id ?? null,
        threadId: thread?.id ?? null,
        threadTitle: thread?.title ?? null,
        branch: thread?.branch ?? null,
        pullRequest,
        bytes: stale ? null : (size?.bytes ?? null),
        packageBytes: stale ? null : (size?.packageBytes ?? null),
        measured: !stale && size !== undefined,
        lastCleanup:
          lastEntry && report
            ? {
                outcome: lastEntry.outcome,
                reason: lastEntry.reason,
                finishedAt: report.finishedAt,
              }
            : null,
      });
    }
    const publish = (measuring: boolean) =>
      SubscriptionRef.set(worktreeListRef, {
        entries: entries.map((entry) => {
          const size = measuredSizes.get(pathKey(entry.path));
          return size === undefined
            ? entry
            : { ...entry, bytes: size.bytes, packageBytes: size.packageBytes, measured: true };
        }),
        measuring,
      });
    const unmeasured = entries.filter((entry) => !measuredSizes.has(pathKey(entry.path)));
    yield* publish(unmeasured.length > 0);
    // Publish at most once a second while measuring; each publish reaches
    // every open Storage page.
    let publishedAt = now;
    yield* Effect.forEach(
      unmeasured,
      Effect.fnUntraced(function* (entry) {
        const measured = yield* measureTree(entry.path).pipe(
          Effect.timeout("2 minutes"),
          Effect.orElseSucceed(() => null),
        );
        measuredSizes.set(pathKey(entry.path), {
          bytes: measured?.bytes ?? null,
          packageBytes: measured?.packageBytes ?? null,
          at: yield* Clock.currentTimeMillis,
        });
        const current = yield* Clock.currentTimeMillis;
        if (current - publishedAt >= 1_000) {
          publishedAt = current;
          yield* publish(true);
        }
      }),
      { concurrency: 2, discard: true },
    );
    for (const key of measuredSizes.keys())
      if (!entries.some((entry) => pathKey(entry.path) === key)) measuredSizes.delete(key);
    yield* publish(false);
  });

  const requestWorktreeList = Effect.fn("StorageCleanup.requestWorktreeList")(function* (
    remeasure: boolean,
  ) {
    if (remeasure) yield* Ref.set(remeasureStale, true);
    const start = yield* Ref.modify(listRefresh, (state) =>
      state === "idle" ? [true, "running" as const] : [false, "queued" as const],
    );
    if (!start) return;
    yield* Effect.forkIn(
      Effect.gen(function* () {
        while (true) {
          yield* refreshWorktreeList(yield* Ref.getAndSet(remeasureStale, false)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("storage worktree list failed", { cause }),
            ),
          );
          const again = yield* Ref.modify(listRefresh, (state) =>
            state === "queued" ? [true, "running" as const] : [false, "idle" as const],
          );
          if (!again) return;
        }
      }),
      serviceScope,
    );
  });

  const worktreeFailure = (error: unknown) =>
    isStorageWorktreeError(error)
      ? error
      : new StorageWorktreeError({
          message:
            typeof error === "object" && error !== null && "message" in error
              ? cleanupFailureReason(error as { readonly message: string })
              : String(error),
        });
  const refuse = (message: string) => Effect.fail(new StorageWorktreeError({ message }));

  /** The checks a manual action shares with cleanup, before anything is touched. */
  const manualTarget = Effect.fn("StorageCleanup.manualTarget")(function* (input: string) {
    const serverSettings = yield* settingsService.getSettings;
    const roots = yield* managedRoots(serverSettings);
    const worktreePath = path.resolve(input);
    if (!(yield* fs.exists(worktreePath))) return yield* refuse("This folder no longer exists.");
    if ((yield* fs.realPath(worktreePath)) !== worktreePath)
      return yield* refuse("This folder is a symbolic link.");
    const root = roots.find((entry) => inside(entry, worktreePath));
    if (root === undefined) return yield* refuse("This folder isn't in a worktree folder.");
    const projects = yield* projectStore.listShells();
    if (yield* containsProjectRoot(worktreePath, projects))
      return yield* refuse("This folder holds a project's main checkout.");
    // Thread paths can reach the folder through a symbolic link.
    const users = yield* Effect.filter(
      yield* projections.getThreadWorktreePaths({ includeArchived: true }),
      (entry) => {
        const resolved = path.resolve(entry.worktreePath);
        return resolved === worktreePath
          ? Effect.succeed(true)
          : fs.realPath(resolved).pipe(
              Effect.map((real) => pathKey(real) === pathKey(worktreePath)),
              Effect.orElseSucceed(() => false),
            );
      },
    );
    const shells = (yield* Effect.forEach(users, (entry) =>
      projections.getThreadShell(entry.threadId),
    )).filter((shell) => shell !== null);
    const now = yield* Clock.currentTimeMillis;
    if (shells.some((shell) => !storageCleanupThreadIdle(shell, now)))
      return yield* refuse("A thread is still working in this worktree.");
    if (hasTerminal(worktreePath)) return yield* refuse("A terminal is open in this worktree.");
    if (yield* liveSessionInside(worktreePath))
      return yield* refuse("An agent session is still open in this worktree.");
    const owner = worktreeOwner(shells) ?? shells[0];
    const project = projects.find((entry) => entry.id === owner?.projectId);
    return { worktreePath, root, serverSettings, owner, project };
  });

  const ignoredEntries = Effect.fnUntraced(function* (worktreePath: string) {
    const ignored = yield* git.execute({
      operation: "StorageCleanup.ignoredFiles",
      cwd: worktreePath,
      args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      maxOutputBytes: 1024 * 1024,
    });
    if (ignored.stdoutTruncated) return yield* refuse("This worktree has too many ignored files.");
    return ignored.stdout.split("\0").filter(Boolean);
  });

  const freeWorktreePackages = Effect.fn("StorageCleanup.freeWorktreePackages")(
    function* (input: StorageWorktreeTarget) {
      const worktreePath = path.resolve(input.path);
      return yield* withWorkspaceLease(
        worktreePath,
        Effect.gen(function* () {
          yield* manualTarget(worktreePath);
          if (!(yield* fs.exists(path.join(worktreePath, ".git"))))
            return yield* refuse("This folder isn't a git worktree.");
          let folders = 0;
          let bytes = 0;
          // Git lists a wholly ignored folder once, and never one holding tracked files.
          for (const entry of yield* ignoredEntries(worktreePath)) {
            if (!REBUILDABLE_IGNORED_PATH.test(entry)) continue;
            const target = path.join(worktreePath, entry);
            if (yield* isSymlink(target.replace(/[\\/]+$/, ""))) continue;
            if (
              (yield* fs.realPath(target)) !== path.resolve(target) ||
              !inside(worktreePath, target)
            )
              continue;
            const measured = yield* measureTree(target).pipe(Effect.orElseSucceed(() => null));
            yield* fs.remove(target, { recursive: true });
            folders++;
            bytes += measured?.bytes ?? 0;
          }
          measuredSizes.delete(pathKey(worktreePath));
          yield* Effect.logInfo("storage freed worktree packages", { worktreePath, folders });
          return { folders, bytes };
        }),
      );
    },
    Effect.mapError(worktreeFailure),
    Effect.ensuring(requestWorktreeList(false)),
  );

  const deleteWorktree = Effect.fn("StorageCleanup.deleteWorktree")(
    function* (input: StorageWorktreeDeleteInput) {
      const worktreePath = path.resolve(input.path);
      return yield* withWorkspaceLease(
        worktreePath,
        Effect.gen(function* () {
          const { root, serverSettings, owner, project } = yield* manualTarget(worktreePath);
          const gitFile = yield* fs
            .stat(path.join(worktreePath, ".git"))
            .pipe(Effect.orElseSucceed(() => null));
          if (gitFile?.type !== "File")
            return yield* refuse("This folder isn't a linked git worktree. Delete it in Finder.");
          const repository = project?.workspaceRoot ?? (yield* repositoryOfWorktree(worktreePath));
          if (repository === null || !(yield* fs.exists(repository)))
            return yield* refuse("This worktree's main checkout is missing.");
          const branch = yield* checkedOutBranch(worktreePath);
          const status = yield* git.execute({
            operation: "StorageCleanup.localChanges",
            cwd: worktreePath,
            args: [
              "status",
              "--porcelain=v1",
              "-z",
              "--ignore-submodules=none",
              "--untracked-files=all",
            ],
            maxOutputBytes: 1024 * 1024,
          });
          if (status.stdoutTruncated)
            return yield* refuse("This worktree has too many changes to back up.");
          const records = status.stdout.split("\0").filter(Boolean);
          const changed: string[] = [];
          for (let i = 0; i < records.length; i++) {
            changed.push(records[i]!.slice(3));
            // A rename or copy is followed by its source path.
            if (/^[RC]|^.[RC]/.test(records[i]!)) i++;
          }
          const existingChanged: string[] = [];
          let changedBytes = 0;
          for (const file of changed) {
            const info = yield* fs
              .stat(path.join(worktreePath, file))
              .pipe(Effect.orElseSucceed(() => null));
            if (info?.type !== "File" || (yield* isSymlink(path.join(worktreePath, file))))
              continue;
            existingChanged.push(file);
            changedBytes += Number(info.size);
          }
          const unique = yield* uniqueFiles(worktreePath, repository);
          let notBackedUp: string | null = null;
          if (unique === null) {
            notBackedUp =
              (yield* ignoredEntries(worktreePath)).find(
                (entry) => !REBUILDABLE_IGNORED_PATH.test(entry),
              ) ?? null;
            if (changedBytes > MAX_BACKUP_BYTES || existingChanged.length > MAX_SCANNED_ENTRIES)
              return yield* refuse(
                "This worktree has more than 100 MB of changes to back up. Commit or move them first.",
              );
          }
          const backupFiles = [...new Set([...(unique ?? []), ...existingChanged])];
          const plan: StorageWorktreeDeletePlan = {
            removed: false,
            branch: branch ?? null,
            changedFiles: changed.length,
            backupFiles: backupFiles.length,
            backupPath: null,
            notBackedUp,
            needsConfirmation: changed.length > 0 || notBackedUp !== null,
          };
          if (input.dryRun) return plan;
          if (plan.needsConfirmation && !input.allowLocalChanges)
            return yield* refuse("This worktree changed since you checked it. Try again.");
          const submodules = yield* submoduleRemoval(worktreePath, {
            ...resolveWorktreeCleanup(serverSettings, owner?.projectId ?? null),
            worktreeKeepWhen: "tracked-changes",
          });
          if (submodules.reason !== null) return yield* refuse(sentence(submodules.reason));
          const backupPath =
            backupFiles.length > 0
              ? yield* backUp(
                  worktreePath,
                  path.relative(root, worktreePath),
                  backupFiles,
                  yield* Clock.currentTimeMillis,
                )
              : null;
          yield* removeLinkedWorktree({
            operation: "StorageCleanup.deleteWorktree",
            cwd: repository,
            worktreePath,
            // Without confirmation, Git still refuses an edit that arrives now.
            force: submodules.force || (input.allowLocalChanges && changed.length > 0),
            execute: git.execute,
            run: (args) => cleanupGit(repository, [...args], "git worktree remove"),
          });
          measuredSizes.delete(pathKey(worktreePath));
          yield* gitManager.invalidateStatus(repository);
          yield* Effect.logInfo("storage deleted worktree", {
            worktreePath,
            threadId: owner?.id ?? null,
            backupPath,
          });
          return { ...plan, removed: true, backupPath };
        }),
      );
    },
    Effect.mapError(worktreeFailure),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.ensuring(requestWorktreeList(false)),
  );

  const start = Effect.fn("StorageCleanup.start")(function* () {
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Effect.sync(() => {
        if (event.type === "snapshot") {
          liveTerminals.clear();
          for (const terminal of event.terminals) noteTerminal(terminal);
        } else if (event.type === "upsert") {
          noteTerminal(event.terminal);
        } else {
          const threadTerminals = liveTerminals.get(event.threadId);
          threadTerminals?.delete(event.terminalId);
          if (threadTerminals?.size === 0) liveTerminals.delete(event.threadId);
        }
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changes = yield* settingsService.subscribeChanges;
    const events = engine.streamDomainEvents;
    let lastSettings = yield* settingsService.getSettings.pipe(Effect.orDie);
    yield* forkParked(
      requestSweep.pipe(
        Effect.andThen(worker.drain),
        Effect.repeat(Schedule.spaced("1 hour")),
        Effect.asVoid,
      ),
    );
    yield* forkParked(
      Stream.runForEach(changes, (settings) => {
        if (
          Equal.equals(settings.storageCleanup, lastSettings.storageCleanup) &&
          Equal.equals(settings.worktreeCleanup, lastSettings.worktreeCleanup) &&
          sameProjectWorktreePolicies(settings, lastSettings)
        )
          return Effect.void;
        lastSettings = settings;
        return requestSweep;
      }),
    );
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        (event.type === "thread.deleted" ||
          (event.type === "provider-session.updated" &&
            (event.payload.status === "stopped" || event.payload.status === "error"))) &&
        anyWorktreePolicy(lastSettings, (rules) => rules.worktreeOnDelete)
          ? requestSweep
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Storage cleanup event stream failed", { cause }),
        ),
      ),
    );
  });
  yield* start();
  return StorageCleanup.of({
    runNow,
    latestReport: SubscriptionRef.get(reportRef),
    reports: SubscriptionRef.changes(reportRef),
    drain: worker.drain,
    worktrees: Stream.unwrap(
      requestWorktreeList(true).pipe(
        Effect.as(
          SubscriptionRef.changes(worktreeListRef).pipe(
            Stream.filter((list): list is StorageWorktreeList => list !== null),
          ),
        ),
      ),
    ),
    freeWorktreePackages,
    deleteWorktree,
  });
});

export const layer = Layer.effect(StorageCleanup, make);

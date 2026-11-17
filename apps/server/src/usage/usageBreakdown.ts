/**
 * Personal build: where a quota window went, for Usage → Limits. Per-session
 * usage from `UsageService`, named by the T3 thread and project each session
 * belongs to.
 *
 * A session joins its thread through the provider thread V2 records for it:
 * its `nativeThreadRef` is the provider's own session id. Sessions no thread
 * names (work run outside T3) fall back to their working directory: a
 * thread's worktree, else the project whose workspace contains it.
 *
 * @module usageBreakdown
 */
import {
  type UsageBreakdown,
  type UsageBreakdownInput,
  type UsageBreakdownSession,
  type UsageProviderKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { BUILT_IN_USAGE_DRIVERS } from "../provider/builtInDrivers.ts";
import { type UsageSessionScanEntry, UsageService } from "./UsageService.ts";

export interface UsageThreadDirectory {
  /** `provider:sessionId` → thread id. */
  readonly sessionThreads: ReadonlyMap<string, string>;
  readonly threads: ReadonlyMap<
    string,
    {
      readonly projectId: string;
      readonly title: string;
      readonly worktreePath: string | null;
      readonly deleted: boolean;
    }
  >;
  readonly projects: ReadonlyMap<
    string,
    { readonly title: string; readonly workspaceRoot: string }
  >;
}

/** The usage kind each driver's history is read as. */
const USAGE_KIND_BY_DRIVER: ReadonlyMap<string, UsageProviderKind> = new Map(
  BUILT_IN_USAGE_DRIVERS.flatMap((driver) =>
    driver.usage ? [[driver.driverKind, driver.usage.provider] as const] : [],
  ),
);

/** Reads which provider sessions, threads, and projects this environment knows. */
export const loadThreadDirectory = Effect.fn("usage.loadThreadDirectory")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const providerThreads = yield* sql<{
    threadId: string;
    driver: string | null;
    nativeId: string | null;
  }>`
    SELECT thread_id AS "threadId",
      COALESCE(driver, json_extract(payload_json, '$.driver')) AS "driver",
      json_extract(payload_json, '$.nativeThreadRef.nativeId') AS "nativeId"
    FROM orchestration_v2_projection_provider_threads
    WHERE thread_id IS NOT NULL
  `;
  const threadRows = yield* sql<{
    threadId: string;
    projectId: string;
    title: string;
    worktreePath: string | null;
    deletedAt: string | null;
  }>`
    SELECT thread_id AS "threadId", project_id AS "projectId", title,
      json_extract(payload_json, '$.worktreePath') AS "worktreePath", deleted_at AS "deletedAt"
    FROM orchestration_v2_projection_threads
  `;
  const projectRows = yield* sql<{ projectId: string; title: string; workspaceRoot: string }>`
    SELECT project_id AS "projectId", title, workspace_root AS "workspaceRoot"
    FROM projection_projects
    WHERE deleted_at IS NULL
  `;
  const sessionThreads = new Map<string, string>();
  for (const row of providerThreads) {
    const provider = row.driver ? USAGE_KIND_BY_DRIVER.get(row.driver) : undefined;
    if (provider && row.nativeId) sessionThreads.set(`${provider}:${row.nativeId}`, row.threadId);
  }
  return {
    sessionThreads,
    threads: new Map(
      threadRows.map((row) => [
        row.threadId,
        {
          projectId: row.projectId,
          title: row.title,
          worktreePath: row.worktreePath,
          deleted: row.deletedAt !== null,
        },
      ]),
    ),
    projects: new Map(
      projectRows.map((row) => [
        row.projectId,
        { title: row.title, workspaceRoot: row.workspaceRoot },
      ]),
    ),
  } satisfies UsageThreadDirectory;
});

// Windows paths may arrive with either separator, a \\?\ prefix, or a different
// drive-letter case, depending on which tool recorded them.
function comparablePath(path: string): string {
  const slashed = path
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "");
  return /^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed;
}

function within(path: string, root: string): boolean {
  const base = comparablePath(root);
  const target = comparablePath(path);
  return base.length > 0 && (target === base || target.startsWith(`${base}/`));
}

/** Names each scanned session by its thread and project, falling back to its working directory. */
export function attributeSessions(
  provider: UsageProviderKind,
  sessions: readonly UsageSessionScanEntry[],
  directory: UsageThreadDirectory,
): UsageBreakdownSession[] {
  // Worktrees that exactly one live thread uses, so a cwd match is unambiguous.
  const worktreeThreads = new Map<string, string | null>();
  for (const [threadId, thread] of directory.threads) {
    if (thread.deleted || !thread.worktreePath) continue;
    const key = thread.worktreePath.replace(/\/+$/, "");
    worktreeThreads.set(key, worktreeThreads.has(key) ? null : threadId);
  }
  const projectFor = (cwd: string) => {
    let best: { id: string; length: number } | null = null;
    for (const [id, project] of directory.projects) {
      if (
        within(cwd, project.workspaceRoot) &&
        project.workspaceRoot.length > (best?.length ?? -1)
      ) {
        best = { id, length: project.workspaceRoot.length };
      }
    }
    return best?.id ?? null;
  };
  const threadForCwd = (cwd: string) => {
    for (const [worktree, threadId] of worktreeThreads) {
      if (threadId && within(cwd, worktree)) return threadId;
    }
    return null;
  };

  return sessions.map((session) => {
    const threadId =
      directory.sessionThreads.get(`${provider}:${session.sessionId}`) ??
      (session.cwd ? threadForCwd(session.cwd) : null);
    const thread = threadId ? directory.threads.get(threadId) : undefined;
    const projectId =
      thread?.projectId ?? (session.cwd ? projectFor(session.cwd) : null) ?? undefined;
    const project = projectId ? directory.projects.get(projectId) : undefined;
    const title = thread?.title.trim() || session.title;
    return {
      provider,
      sessionId: session.sessionId,
      ...(threadId && thread && !thread.deleted ? { threadId } : {}),
      ...(title ? { title } : {}),
      ...(projectId && project ? { projectId, projectTitle: project.title } : {}),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      ...(session.origin ? { origin: session.origin } : {}),
      costUsd: session.costUsd,
      totals: session.totals,
      records: session.records,
      models: session.models.map((model) => ({ ...model })),
      hours: session.hours.map((hour) => ({
        hourStart: DateTime.formatIso(DateTime.makeUnsafe(hour.hourStartMs)),
        costUsd: hour.costUsd,
        records: hour.records,
      })),
    };
  });
}

const EMPTY_DIRECTORY: UsageThreadDirectory = {
  sessionThreads: new Map(),
  threads: new Map(),
  projects: new Map(),
};

/** Per-session usage for one provider window, named by thread and project. */
export const readUsageBreakdown = Effect.fn("usage.readUsageBreakdown")(function* (
  input: UsageBreakdownInput,
) {
  const usage = yield* UsageService;
  const scan = yield* usage.readSessions(input);
  // Unnamed sessions are still worth showing; a read failure only costs the names.
  const directory = yield* loadThreadDirectory().pipe(
    Effect.tapCause((cause) => Effect.logWarning("Usage breakdown could not read threads", cause)),
    Effect.orElseSucceed(() => EMPTY_DIRECTORY),
  );
  return {
    readAt: scan.readAt,
    provider: input.provider,
    sinceTime: input.sinceTime,
    untilTime: input.untilTime,
    sessions: attributeSessions(input.provider, scan.sessions, directory),
  } satisfies UsageBreakdown;
});

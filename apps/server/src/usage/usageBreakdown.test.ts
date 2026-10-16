import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import {
  attributeSessions,
  loadThreadDirectory,
  type UsageThreadDirectory,
} from "./usageBreakdown.ts";
import type { UsageSessionScanEntry } from "./UsageService.ts";

function session(overrides: Partial<UsageSessionScanEntry>): UsageSessionScanEntry {
  return {
    sessionId: "s",
    filePath: "/x.jsonl",
    costUsd: 1,
    totals: {
      uncachedInputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
    records: 1,
    models: [],
    hours: [{ hourStartMs: Date.parse("2026-10-08T10:00:00.000Z"), costUsd: 1, records: 1 }],
    ...overrides,
  };
}

const directory: UsageThreadDirectory = {
  sessionThreads: new Map([["claude:resumed", "thread-1"]]),
  threads: new Map([
    ["thread-1", { projectId: "p1", title: "Invoice split", worktreePath: null, deleted: false }],
    [
      "thread-2",
      { projectId: "p1", title: "Worktree chat", worktreePath: "/wt/feature", deleted: false },
    ],
    ["thread-3", { projectId: "p1", title: "Gone", worktreePath: null, deleted: true }],
  ]),
  projects: new Map([
    ["p1", { title: "Acme", workspaceRoot: "/code/acme" }],
    ["p2", { title: "Acme web", workspaceRoot: "/code/acme/web" }],
  ]),
};

describe("attributeSessions", () => {
  it("joins a session to its thread through the resume cursor", () => {
    const [result] = attributeSessions("claude", [session({ sessionId: "resumed" })], directory);
    expect(result).toMatchObject({
      threadId: "thread-1",
      title: "Invoice split",
      projectId: "p1",
      projectTitle: "Acme",
    });
  });

  it("falls back to a thread's worktree, then the deepest containing project", () => {
    const [worktree, nested, outside] = attributeSessions(
      "claude",
      [
        session({ sessionId: "a", cwd: "/wt/feature/apps/server" }),
        session({ sessionId: "b", cwd: "/code/acme/web/src", title: "CLI title" }),
        session({ sessionId: "c", cwd: "/tmp" }),
      ],
      directory,
    );
    expect(worktree).toMatchObject({ threadId: "thread-2", projectTitle: "Acme" });
    expect(nested).toMatchObject({ title: "CLI title", projectId: "p2" });
    expect(nested?.threadId).toBeUndefined();
    expect(outside?.projectId).toBeUndefined();
    expect(outside?.cwd).toBe("/tmp");
  });

  it("matches Windows working directories however they were recorded", () => {
    const [result] = attributeSessions(
      "codex",
      [session({ sessionId: "win", cwd: "\\\\?\\c:\\Code\\Acme\\src" })],
      {
        ...directory,
        projects: new Map([["p1", { title: "Acme", workspaceRoot: "C:/Code/Acme" }]]),
      },
    );
    expect(result).toMatchObject({ projectId: "p1" });
  });

  it("keeps a deleted thread's title without linking to it", () => {
    const [result] = attributeSessions("codex", [session({ sessionId: "gone" })], {
      ...directory,
      sessionThreads: new Map([["codex:gone", "thread-3"]]),
    });
    expect(result?.title).toBe("Gone");
    expect(result?.threadId).toBeUndefined();
  });
});

describe("loadThreadDirectory", () => {
  it.effect("joins provider sessions to chats through V2 provider threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const at = "2026-10-08T10:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES ('p1', 'Acme', '/code/acme', '[]', ${at}, ${at}, NULL),
          ('p-gone', 'Old', '/code/old', '[]', ${at}, ${at}, ${at})
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, deleted_at, payload_json)
        VALUES ('thread-1', 'p1', 'Invoice split', 'claudeAgent', 'full-access', 'default', ${at}, ${at}, NULL, '{"worktreePath":"/wt/invoice"}'),
          ('thread-2', 'p1', 'Removed', 'codex', 'full-access', 'default', ${at}, ${at}, ${at}, '{}')
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_threads (provider_thread_id, thread_id, provider, driver, status, updated_at, payload_json)
        VALUES
          ('pt-1', 'thread-1', 'claudeAgent', 'claudeAgent', 'idle', ${at}, '{"nativeThreadRef":{"driver":"claudeAgent","nativeId":"claude-session","strength":"strong"}}'),
          ('pt-2', 'thread-2', 'codex', 'codex', 'idle', ${at}, '{"nativeThreadRef":{"driver":"codex","nativeId":"codex-thread","strength":"strong"}}'),
          ('pt-3', 'thread-1', 'codex', 'codex', 'idle', ${at}, '{"nativeThreadRef":null}'),
          ('pt-4', NULL, 'codex', 'codex', 'idle', ${at}, '{"nativeThreadRef":{"driver":"codex","nativeId":"orphan","strength":"strong"}}')
      `;

      const directory = yield* loadThreadDirectory();
      expect([...directory.sessionThreads]).toEqual([
        ["claude:claude-session", "thread-1"],
        ["codex:codex-thread", "thread-2"],
      ]);
      expect(directory.threads.get("thread-1")).toEqual({
        projectId: "p1",
        title: "Invoice split",
        worktreePath: "/wt/invoice",
        deleted: false,
      });
      expect(directory.threads.get("thread-2")?.deleted).toBe(true);
      expect([...directory.projects.keys()]).toEqual(["p1"]);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
  );
});

import { RunId, ThreadId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import { closeCutQuote, liveWorkLine } from "./liveWorkLine";

// Personal build: what a working chat's sidebar row (and live line) says.

const TURN_START = "2026-10-15T10:00:00.000Z";

function command(input: string, startedAt: string): OrchestrationV2TurnItem {
  return {
    type: "command_execution",
    id: TurnItemId.make("item-1"),
    threadId: ThreadId.make("thread-test"),
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "running",
    title: null,
    startedAt: DateTime.makeUnsafe(startedAt),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe(startedAt),
    input,
  };
}

function working(
  overrides: {
    liveActivity?: OrchestrationV2TurnItem | null;
    note?: { text: string; updatedAt: string };
  } = {},
) {
  const thread = makeThreadFixture({
    latestRun: {
      runId: RunId.make("run-1"),
      status: "running",
      requestedAt: TURN_START,
      startedAt: TURN_START,
      completedAt: null,
      assistantMessageId: null,
    },
  });
  return {
    ...thread,
    runtime: {
      status: "running" as const,
      activeRunId: RunId.make("run-1"),
      activityStartedAt: TURN_START,
      providerInstanceId: thread.providerInstanceId,
      providerName: null,
      lastError: null,
      lastErrorClass: null,
      usageLimitResetAt: null,
      updatedAt: TURN_START,
    },
    liveActivity: overrides.liveActivity ?? null,
    latestVisibleMessage: overrides.note
      ? { role: "assistant", text: overrides.note.text, updatedAt: overrides.note.updatedAt }
      : null,
  };
}

describe("liveWorkLine", () => {
  it("says Thinking between steps", () => {
    expect(liveWorkLine(working())).toBe("Thinking");
  });

  it("names the running step", () => {
    expect(
      liveWorkLine(working({ liveActivity: command("git status", "2026-10-15T10:01:00.000Z") })),
    ).toBe("Running git");
  });

  it("prefers the agent's note from this turn when it is newer than the step", () => {
    expect(
      liveWorkLine(
        working({
          liveActivity: command("git status", "2026-10-15T10:01:00.000Z"),
          note: { text: "Checking **the** zoom bar", updatedAt: "2026-10-15T10:02:00.000Z" },
        }),
      ),
    ).toBe("Checking the zoom bar");
  });

  it("never shows the previous turn's answer", () => {
    expect(
      liveWorkLine(
        working({ note: { text: "Old answer", updatedAt: "2026-10-15T09:00:00.000Z" } }),
      ),
    ).toBe("Thinking");
  });

  it("names a program even when the server cut its command inside a quote", () => {
    expect(
      liveWorkLine(
        working({ liveActivity: command(`sqlite3 db "select * from`, "2026-10-15T10:01:00.000Z") }),
      ),
    ).toBe("Running sqlite3");
  });
});

describe("closeCutQuote", () => {
  it("closes an unterminated quote and leaves balanced ones alone", () => {
    expect(closeCutQuote(`echo "hi`)).toBe(`echo "hi"`);
    expect(closeCutQuote(`echo 'a' "b"`)).toBe(`echo 'a' "b"`);
  });
});

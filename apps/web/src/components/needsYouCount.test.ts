import { describe, expect, it } from "vite-plus/test";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { RunId, ThreadId } from "@t3tools/contracts";

import { makeThreadFixture } from "../test-fixtures";
import {
  countThreadsNeedingYou,
  isThreadUnread,
  threadWaitingOnYou,
  yourTurnSince,
} from "./needsYouCount";
import { resolveThreadRowLine, sidebarThreadState } from "./sidebar/threadGroups";

// Personal build: the sidebar's Waiting on you and unread rules, and the Dock badge count.

const NOW = "2026-10-15T12:00:00.000Z";

function finished(completedAt: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) {
  return makeThreadFixture({
    latestRun: {
      runId: RunId.make("run-1"),
      status: "completed",
      requestedAt: "2026-10-15T09:00:00.000Z",
      startedAt: "2026-10-15T09:00:01.000Z",
      completedAt,
      assistantMessageId: null,
    },
    runtime: null,
    ...overrides,
  });
}

const runtime = (
  status: "running" | "idle" | "failed",
  updatedAt = "2026-10-15T10:00:00.000Z",
) => ({
  status,
  activeRunId: status === "running" ? RunId.make("run-1") : null,
  providerInstanceId: makeThreadFixture().providerInstanceId,
  providerName: null,
  lastError: status === "failed" ? "boom" : null,
  lastErrorClass: null,
  usageLimitResetAt: null,
  updatedAt,
});

describe("yourTurnSince", () => {
  it("is when the turn finished, or when it started waiting on you", () => {
    expect(yourTurnSince(finished("2026-10-15T10:00:00.000Z"))).toBe("2026-10-15T10:00:00.000Z");
    expect(
      yourTurnSince(
        finished("2026-10-15T10:00:00.000Z", {
          hasPendingApprovals: true,
          updatedAt: "2026-10-15T11:00:00.000Z",
        }),
      ),
    ).toBe("2026-10-15T11:00:00.000Z");
    expect(
      yourTurnSince(
        finished("2026-10-15T10:00:00.000Z", {
          runtime: runtime("failed", "2026-10-15T10:30:00.000Z"),
        }),
      ),
    ).toBe("2026-10-15T10:30:00.000Z");
    expect(yourTurnSince(makeThreadFixture({ latestRun: null, runtime: null }))).toBeNull();
  });
});

describe("isThreadUnread", () => {
  it("is unread when your turn came after your last visit, and reading clears it", () => {
    const thread = finished("2026-10-15T10:00:00.000Z");
    expect(isThreadUnread(thread, "2026-10-15T09:30:00.000Z", NOW)).toBe(true);
    expect(isThreadUnread(thread, "2026-10-15T10:00:00.000Z", NOW)).toBe(false);
  });

  it("counts a never-visited thread as read, so history doesn't light up", () => {
    expect(isThreadUnread(finished("2026-10-15T10:00:00.000Z"), undefined, NOW)).toBe(false);
  });

  it("counts a failure nobody has opened as unread", () => {
    const thread = finished("2026-10-15T10:00:00.000Z", {
      runtime: runtime("failed", "2026-10-15T10:30:00.000Z"),
    });
    const failed = { ...thread, latestRun: { ...thread.latestRun!, status: "failed" as const } };
    expect(isThreadUnread(failed, undefined, NOW)).toBe(true);
    expect(isThreadUnread(failed, "2026-10-15T10:45:00.000Z", NOW)).toBe(false);
  });

  it("turns unread again when an approval arrives after you looked", () => {
    const thread = finished("2026-10-15T10:00:00.000Z", {
      hasPendingApprovals: true,
      updatedAt: "2026-10-15T11:00:00.000Z",
    });
    expect(isThreadUnread(thread, "2026-10-15T10:30:00.000Z", NOW)).toBe(true);
  });

  it("is unread when a snooze woke after your last visit", () => {
    const thread = finished("2026-10-15T08:00:00.000Z", {
      snoozedAt: "2026-10-15T08:30:00.000Z",
      snoozedUntil: "2026-10-15T11:00:00.000Z",
    });
    expect(isThreadUnread(thread, "2026-10-15T09:00:00.000Z", NOW)).toBe(true);
    expect(isThreadUnread(thread, "2026-10-15T11:30:00.000Z", NOW)).toBe(false);
  });
});

describe("threadWaitingOnYou", () => {
  const merge = {
    kind: "merge" as const,
    reason: "PR #1058 is ready to merge",
    since: "2026-10-15T10:00:00.000Z",
  };

  it("keeps what the agent set after you read the thread, until the agent clears it", () => {
    const thread = finished("2026-10-15T10:00:00.000Z", {
      waitingOnYou: merge,
      lastVisitedAt: "2026-10-15T11:00:00.000Z",
    });
    expect(isThreadUnread(thread, thread.lastVisitedAt ?? undefined, NOW)).toBe(false);
    expect(threadWaitingOnYou(thread)).toEqual(merge);
    expect(sidebarThreadState(thread)).toBe("waiting-on-you");
    expect(threadWaitingOnYou({ ...thread, waitingOnYou: null })).toBeNull();
    expect(sidebarThreadState({ ...thread, waitingOnYou: null })).toBeNull();
  });

  it("counts a pending approval, question, or subagent request on its own, until you answer", () => {
    const at = { updatedAt: "2026-10-15T11:00:00.000Z" };
    for (const pending of [
      { hasPendingApprovals: true },
      { hasPendingUserInput: true },
      { pendingSubagentRequest: "approval" as const },
    ]) {
      const thread = finished("2026-10-15T10:00:00.000Z", {
        ...at,
        ...pending,
        runtime: runtime("running"),
        lastVisitedAt: "2026-10-15T11:30:00.000Z",
      });
      expect(threadWaitingOnYou(thread)).toMatchObject({ since: at.updatedAt, reason: null });
      expect(sidebarThreadState(thread)).toBe("waiting-on-you");
    }
    const answered = finished("2026-10-15T10:00:00.000Z", { runtime: runtime("running") });
    expect(threadWaitingOnYou(answered)).toBeNull();
    expect(sidebarThreadState(answered)).toBe("working");
  });

  it("outranks Working, and the row says what the agent is waiting for", () => {
    const thread = finished("2026-10-15T10:00:00.000Z", {
      waitingOnYou: merge,
      runtime: runtime("running"),
    });
    expect(sidebarThreadState(thread)).toBe("waiting-on-you");
    const line = resolveThreadRowLine({
      thread,
      status: "working",
      topStatus: { label: "Working", icon: "working", className: "" },
      hasUnsentDraft: false,
      draftPrompt: "",
      fallback: [],
    });
    expect(line).toMatchObject({
      status: { label: "Merge" },
      details: "PR #1058 is ready to merge",
    });
  });
});

describe("countThreadsNeedingYou", () => {
  const capabilities = () => ({ threadSnooze: true, threadSettlement: true });

  it("counts unread threads, pinned or not, using the server's visited mark", () => {
    const threads = [
      finished("2026-10-15T10:00:00.000Z", { lastVisitedAt: "2026-10-15T09:00:00.000Z" }),
      finished("2026-10-15T10:00:00.000Z", {
        id: ThreadId.make("thread-pinned"),
        pinnedAt: "2026-10-14T00:00:00.000Z",
        lastVisitedAt: "2026-10-15T09:00:00.000Z",
      }),
      finished("2026-10-15T10:00:00.000Z", {
        id: ThreadId.make("thread-read"),
        lastVisitedAt: "2026-10-15T10:05:00.000Z",
      }),
    ];
    expect(countThreadsNeedingYou(threads, capabilities, {}, NOW)).toBe(2);
  });

  it("leaves out working, settled, archived, and subagent threads", () => {
    const visit = { lastVisitedAt: "2026-10-15T09:00:00.000Z" };
    const threads = [
      finished("2026-10-15T10:00:00.000Z", { ...visit, runtime: runtime("running") }),
      finished("2026-10-15T10:00:00.000Z", { ...visit, runtime: runtime("idle") }),
      finished("2026-10-15T10:00:00.000Z", { ...visit, settledOverride: "settled" }),
      finished("2026-10-15T10:00:00.000Z", { ...visit, archivedAt: "2026-10-15T10:01:00.000Z" }),
      finished("2026-10-15T10:00:00.000Z", {
        ...visit,
        lineage: {
          rootThreadId: makeThreadFixture().id,
          parentThreadId: makeThreadFixture().id,
          relationshipToParent: "subagent",
        },
      }),
    ];
    expect(countThreadsNeedingYou(threads, capabilities, {}, NOW)).toBe(0);
  });

  it("counts threads waiting on you even once read, but not snoozed ones", () => {
    const waitingOnYou = {
      kind: "decision" as const,
      reason: "Choose how refunds split",
      since: "2026-10-15T10:00:00.000Z",
    };
    const threads = [
      finished("2026-10-15T10:00:00.000Z", {
        waitingOnYou,
        lastVisitedAt: "2026-10-15T11:00:00.000Z",
      }),
      finished("2026-10-15T10:00:00.000Z", {
        id: ThreadId.make("thread-snoozed"),
        waitingOnYou,
        snoozedAt: "2026-10-15T11:00:00.000Z",
        snoozedUntil: "2026-10-16T09:00:00.000Z",
      }),
    ];
    expect(countThreadsNeedingYou(threads, capabilities, {}, NOW)).toBe(1);
  });

  it("falls back to the local visited mark on servers without visited tracking", () => {
    const thread = finished("2026-10-15T10:00:00.000Z");
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    expect(
      countThreadsNeedingYou([thread], capabilities, { [key]: "2026-10-15T09:00:00.000Z" }, NOW),
    ).toBe(1);
    expect(
      countThreadsNeedingYou([thread], capabilities, { [key]: "2026-10-15T10:30:00.000Z" }, NOW),
    ).toBe(0);
  });
});

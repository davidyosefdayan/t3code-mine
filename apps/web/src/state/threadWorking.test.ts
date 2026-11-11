import { RunId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import { createThreadWorkingSignal } from "./threadWorking";

// The tracker's exit grace (`WORKING_EXIT_GRACE_MS` in client-runtime's threadInbox).
const WORKING_EXIT_GRACE_MS = 2_000;

const run = (status: "running" | "completed") => ({
  runId: RunId.make("run-1"),
  status,
  requestedAt: "2026-10-15T09:00:00.000Z",
  startedAt: "2026-10-15T09:00:01.000Z",
  completedAt: status === "completed" ? "2026-10-15T10:00:00.000Z" : null,
  assistantMessageId: null,
});
const working = makeThreadFixture({
  latestRun: run("running"),
  runtime: {
    status: "running",
    activeRunId: RunId.make("run-1"),
    providerInstanceId: makeThreadFixture().providerInstanceId,
    providerName: null,
    lastError: null,
    lastErrorClass: null,
    usageLimitResetAt: null,
    updatedAt: "2026-10-15T09:00:01.000Z",
  },
});
const done = makeThreadFixture({ latestRun: run("completed"), runtime: null });

function harness() {
  const signal = createThreadWorkingSignal();
  const changes = vi.fn();
  signal.subscribe(changes);
  return { signal, changes, isWorking: () => signal.isWorking()(done) };
}

describe("createThreadWorkingSignal", () => {
  it("lets a finished chat leave Working once, when the grace ends", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-15T12:00:00.000Z") });
    try {
      const { signal, changes, isWorking } = harness();
      signal.observe([working]);
      signal.observe([done]);
      expect(isWorking()).toBe(true);
      vi.advanceTimersByTime(WORKING_EXIT_GRACE_MS - 1);
      expect(changes).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(changes).toHaveBeenCalledTimes(1);
      expect(isWorking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a chat that resumes within the grace in Working, with no change", () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-15T12:00:00.000Z") });
    try {
      const { signal, changes, isWorking } = harness();
      signal.observe([working]);
      signal.observe([done]);
      vi.advanceTimersByTime(WORKING_EXIT_GRACE_MS / 2);
      signal.observe([working]);
      vi.advanceTimersByTime(WORKING_EXIT_GRACE_MS * 2);
      expect(changes).not.toHaveBeenCalled();
      expect(signal.isWorking()(working)).toBe(true);
      expect(isWorking()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a chat that leaves Working at once, such as a pinned one", () => {
    const { signal, changes } = harness();
    const pinned = { pinnedAt: "2026-10-15T08:00:00.000Z" };
    signal.observe([{ ...working, ...pinned }]);
    signal.observe([{ ...done, ...pinned }]);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(signal.isWorking()({ ...done, ...pinned })).toBe(false);
  });
});

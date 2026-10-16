import { describe, expect, it } from "@effect/vitest";

import type { UsageRecord } from "@t3tools/provider-core/server/usage";

import type { RateTable } from "./usagePricing.ts";
import {
  parseCodexSessionIndex,
  parseSessionHead,
  UsageSessionAggregator,
} from "./usageSessions.ts";

const rates: RateTable = new Map([
  [
    "claude-fable-5",
    {
      inputCostPerToken: 1e-5,
      outputCostPerToken: 5e-5,
      cacheReadCostPerToken: 1e-6,
      cacheCreationCostPerToken: 1.25e-5,
      fast: null,
      ultrafast: null,
    },
  ],
]);

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: Date.parse("2026-10-08T10:15:00.000Z"),
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 100,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    speed: "standard",
    dedupeKey: null,
    ...overrides,
  };
}

function aggregator() {
  return new UsageSessionAggregator({
    provider: "claude",
    sinceTimeMs: Date.parse("2026-10-08T00:00:00.000Z"),
    untilTimeMs: Date.parse("2026-10-09T00:00:00.000Z"),
    rates,
  });
}

describe("UsageSessionAggregator", () => {
  it("totals each session by hour and model, most expensive first", () => {
    const sessions = aggregator();
    sessions.add(record(), "/a.jsonl");
    sessions.add(record({ timestampMs: Date.parse("2026-10-08T10:50:00.000Z") }), "/a.jsonl");
    sessions.add(record({ timestampMs: Date.parse("2026-10-08T12:01:00.000Z") }), "/a.jsonl");
    sessions.add(record({ sessionId: "session-b" }), "/b.jsonl");

    const [first, second] = sessions.finish();
    expect(first?.sessionId).toBe("session-a");
    expect(first?.records).toBe(3);
    expect(first?.costUsd).toBeCloseTo(0.018);
    expect(first?.hours.map((hour) => [hour.hourStartMs, hour.records])).toEqual([
      [Date.parse("2026-10-08T10:00:00.000Z"), 2],
      [Date.parse("2026-10-08T12:00:00.000Z"), 1],
    ]);
    expect(first?.models).toEqual([
      { model: "claude-fable-5", costUsd: first?.costUsd, records: 3 },
    ]);
    expect(second?.sessionId).toBe("session-b");
  });

  it("skips other providers, out-of-window records, and duplicates", () => {
    const sessions = aggregator();
    sessions.add(record({ dedupeKey: "m1" }), "/a.jsonl");
    sessions.add(record({ dedupeKey: "m1" }), "/copy.jsonl");
    sessions.add(record({ provider: "codex" }), "/a.jsonl");
    sessions.add(record({ timestampMs: Date.parse("2026-10-09T00:00:00.000Z") }), "/a.jsonl");

    const result = sessions.finish();
    expect(result).toHaveLength(1);
    expect(result[0]?.records).toBe(1);
  });

  it("names a session by its own transcript rather than a subagent's", () => {
    const sessions = aggregator();
    sessions.add(record(), "/p/session-a/subagents/agent-1.jsonl");
    sessions.add(record(), "/p/session-a.jsonl");
    expect(sessions.finish()[0]?.filePath).toBe("/p/session-a.jsonl");
  });
});

describe("parseSessionHead", () => {
  it("reads the Claude working directory and title", () => {
    const head = [
      '{"type":"ai-title","aiTitle":"Fix \\"login\\" flow","sessionId":"s"}',
      '{"type":"user","cwd":"/Users/me/app","message":{"content":"hi"}}',
    ].join("\n");
    expect(parseSessionHead(head)).toEqual({ cwd: "/Users/me/app", title: 'Fix "login" flow' });
  });

  it("reads the Codex session_meta working directory", () => {
    const head =
      '{"type":"session_meta","payload":{"id":"x","cwd":"/work/repo","originator":"codex_exec"}}';
    expect(parseSessionHead(head)).toEqual({ cwd: "/work/repo", origin: "codex_exec" });
  });

  it("ignores a summary field that is not a summary line", () => {
    expect(parseSessionHead('{"tool":{"summary":"not a title"}}')).toEqual({});
  });
});

describe("parseCodexSessionIndex", () => {
  it("keeps the newest name per thread and tolerates a torn line", () => {
    const names = parseCodexSessionIndex(
      [
        '{"id":"a","thread_name":"First"}',
        '{"id":"a","thread_name":"Renamed"}',
        '{"id":"b","thread_name":"Other"}',
        '{"id":"c","thread_na',
      ].join("\n"),
    );
    expect([...names]).toEqual([
      ["a", "Renamed"],
      ["b", "Other"],
    ]);
  });
});

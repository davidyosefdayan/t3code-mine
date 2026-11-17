import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BreakdownSession,
  computeLimitInsights,
  mergeBreakdownSessions,
  modelLabel,
  projectLabelOf,
} from "./limitInsights";

const HOUR = 60 * 60 * 1000;
const environmentId = "env-1" as EnvironmentId;
const startMs = Date.parse("2026-10-06T09:00:00.000Z");

function session(
  sessionId: string,
  hours: ReadonlyArray<readonly [offsetHours: number, costUsd: number, records?: number]>,
  overrides: Partial<BreakdownSession> = {},
): BreakdownSession {
  const totalCost = hours.reduce((sum, [, cost]) => sum + cost, 0);
  return {
    environmentId,
    provider: "claude",
    sessionId,
    threadId: `thread-${sessionId}`,
    title: `Chat ${sessionId}`,
    projectId: "p1",
    projectTitle: "Acme",
    costUsd: totalCost,
    totals: {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    },
    records: hours.reduce((sum, [, , records = 1]) => sum + records, 0),
    models: [{ model: "claude-opus-4-6", costUsd: totalCost, records: 1 }],
    hours: hours.map(([offset, costUsd, records = 1]) => ({
      hourStart: new Date(startMs + offset * HOUR).toISOString(),
      costUsd,
      records,
    })),
    ...overrides,
  };
}

const window = (usedPercent: number, nowOffsetHours: number) => ({
  usedPercent,
  startMs,
  resetsAtMs: startMs + 7 * 24 * HOUR,
  nowMs: startMs + nowOffsetHours * HOUR,
});

describe("computeLimitInsights", () => {
  it("splits the used share by each chat's cost", () => {
    const insights = computeLimitInsights(window(40, 48), [
      session("a", [[1, 3]]),
      session("b", [[2, 1]], { projectId: "p2", projectTitle: "T3 Code" }),
    ]);
    expect(insights.chats.map((chat) => [chat.title, chat.points])).toEqual([
      ["Chat a", 30],
      ["Chat b", 10],
    ]);
    expect(insights.projects.map((project) => [project.label, project.points])).toEqual([
      ["Acme", 30],
      ["T3 Code", 10],
    ]);
    expect(insights.models).toEqual([{ label: "Opus 4.6", points: 40, share: 1 }]);
  });

  it("expresses a chat's share against the full weekly limit", () => {
    const insights = computeLimitInsights(window(7, 5 + 35 / 60), [
      session("big", [[1, 37]]),
      session("small", [[2, 33]]),
      session("other", [[3, 30]]),
    ]);
    expect(insights.chats[0]?.points).toBeCloseTo(2.59);
    expect(insights.chats.reduce((sum, chat) => sum + chat.points, 0)).toBeCloseTo(7);
    expect(insights.forecast.status).toBe("early");
    expect(insights.forecast.dailyBudget).toBeCloseTo(93 / ((168 - 5 - 35 / 60) / 24));
    expect(insights.insights.find((insight) => insight.id === "top-chat")).toMatchObject({
      title: "Largest chat: about 2.6% of your weekly limit",
      tone: "info",
    });
  });

  it("does not report zero daily usage when chat records are missing", () => {
    const insights = computeLimitInsights(window(7, 48), []);
    expect(insights.forecast.today).toBeNull();
    expect(insights.forecast.last24h).toBeNull();
    expect(insights.chats).toEqual([]);
  });

  it("keeps the daily allowance within the remaining weekly allowance", () => {
    expect(computeLimitInsights(window(70, 162), []).forecast.dailyBudget).toBe(30);
    expect(computeLimitInsights(window(70, 168), []).forecast.dailyBudget).toBe(0);
  });

  it("ignores usage from before the window opened", () => {
    const insights = computeLimitInsights(window(10, 24), [
      session("a", [
        [-5, 100],
        [1, 1],
      ]),
    ]);
    expect(insights.totalCostUsd).toBe(1);
    expect(insights.chats[0]?.points).toBe(10);
  });

  it("forecasts running out when spending faster than the week elapses", () => {
    // 60% used one day into a seven-day week, all of it in the last 24 hours.
    const insights = computeLimitInsights(window(60, 24), [session("a", [[10, 1]])]);
    expect(insights.forecast.status).toBe("runsOut");
    expect(insights.forecast.runsOutAtMs).toBe(startMs + 24 * HOUR + (40 / 2.5) * HOUR);
    expect(insights.forecast.dailyBudget).toBeCloseTo(40 / 6);
  });

  it("is on track when spending below even pace", () => {
    const insights = computeLimitInsights(window(10, 96), [session("a", [[1, 1]])]);
    expect(insights.forecast.status).toBe("onTrack");
    expect(insights.forecast.runsOutAtMs).toBeNull();
    expect(insights.forecast.last24h).toBe(0);
  });

  it("shows a thread once even when it spans several provider sessions", () => {
    const insights = computeLimitInsights(window(30, 48), [
      session("old", [[1, 1]], { threadId: "thread-x" }),
      session("new", [[2, 2]], { threadId: "thread-x" }),
      session("cli", [[3, 7]], { threadId: undefined, origin: "codex_exec" }),
    ]);
    expect(insights.chats.map((chat) => [chat.origin, chat.points, chat.responses])).toEqual([
      ["codex exec", 21, 1],
      [null, 9, 2],
    ]);
    expect(insights.chats[1]?.session.sessionId).toBe("new");
  });

  it("warns when the pace lands close to the limit without crossing it", () => {
    // 42% four days in, half of it in the last day: a blended pace of 0.66 points an hour.
    const insights = computeLimitInsights(window(42, 96), [
      session("a", [
        [1, 1],
        [80, 1],
      ]),
    ]);
    expect(insights.forecast.last24h).toBe(21);
    expect(insights.forecast.projectedUsedAtReset).toBeCloseTo(89.25);
    expect(insights.forecast.status).toBe("tight");
    expect(insights.forecast.runsOutAtMs).toBeNull();
    expect(insights.insights[0]?.id).toBe("budget");
  });

  it("calls the first day early instead of forecasting from one afternoon", () => {
    const insights = computeLimitInsights(window(10, 5), [session("a", [[1, 1]])]);
    expect(insights.forecast.status).toBe("early");
  });

  it("flags a chat that dominates the week", () => {
    const insights = computeLimitInsights(window(50, 72), [
      session("big", [[1, 8]]),
      session("small", [[2, 2]]),
    ]);
    expect(insights.insights.find((insight) => insight.id === "top-chat")?.title).toBe(
      "Largest chat: about 40% of your weekly limit",
    );
  });
});

describe("mergeBreakdownSessions", () => {
  it("keeps one copy of a session two environments both read, preferring the named one", () => {
    const other = "env-2" as EnvironmentId;
    const unnamed = session("a", [[1, 1]], { threadId: undefined });
    const merged = mergeBreakdownSessions([
      { environmentId, sessions: [unnamed] },
      { environmentId: other, sessions: [session("a", [[1, 1]])] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.environmentId).toBe(other);
  });
});

describe("labels", () => {
  it("names models and folders", () => {
    expect(modelLabel("claude-opus-4-6")).toBe("Opus 4.6");
    expect(modelLabel("claude-fable-5")).toBe("Fable 5");
    expect(modelLabel("gpt-5.5-codex")).toBe("gpt-5.5-codex");
    expect(projectLabelOf(session("a", [], { projectTitle: undefined, cwd: "/private/tmp" }))).toBe(
      "Temporary folder",
    );
    expect(
      projectLabelOf(
        session("a", [], {
          projectTitle: undefined,
          cwd: "/Users/me/.codex/.chatgpt-projects/g-p-6810",
        }),
      ),
    ).toBe("Codex app chats");
    expect(projectLabelOf(session("a", [], { projectTitle: undefined, cwd: "/code/app/" }))).toBe(
      "app",
    );
  });
});

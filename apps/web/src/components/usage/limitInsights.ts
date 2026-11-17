/**
 * Personal build: Usage → Limits.
 *
 * Turns one quota window plus per-session usage into what the Limits view
 * shows: a forecast, where the usage went, and when.
 *
 * Providers report only a percentage per window. Sessions carry API-equivalent
 * cost, not measured subscription usage. Allocating the reported percentage
 * by recorded cost is a rough estimate: provider metering and activity missing
 * from these records can change the actual share attributable to each chat.
 */
import type { EnvironmentId, UsageBreakdownSession } from "@t3tools/contracts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface LimitWindowInput {
  readonly usedPercent: number;
  readonly startMs: number;
  readonly resetsAtMs: number;
  readonly nowMs: number;
}

export interface BreakdownSession extends UsageBreakdownSession {
  readonly environmentId: EnvironmentId;
}

export type ForecastStatus = "early" | "onTrack" | "tight" | "runsOut";

/** Under a day in, one busy afternoon would read as a weekly trend. */
const EARLY_HOURS = 24;

export interface LimitForecast {
  readonly status: ForecastStatus;
  /** Projected share used at reset, uncapped. */
  readonly projectedUsedAtReset: number;
  readonly runsOutAtMs: number | null;
  /** Remaining points spread over days until reset, capped at the amount left. */
  readonly dailyBudget: number;
  readonly averagePerDay: number;
  readonly last24h: number | null;
  readonly today: number | null;
  readonly ratePerHour: number;
}

export interface ProjectShare {
  readonly key: string;
  readonly label: string;
  readonly points: number;
  readonly share: number;
  readonly chats: number;
}

export interface ChatShare {
  readonly key: string;
  readonly session: BreakdownSession;
  readonly title: string;
  readonly projectLabel: string;
  readonly outsideT3: boolean;
  /** Where a session outside T3 came from (`Codex app`, `Claude CLI`), when known. */
  readonly origin: string | null;
  readonly points: number;
  readonly share: number;
  readonly lastActiveMs: number;
  readonly models: readonly string[];
  readonly responses: number;
}

export interface ModelShare {
  readonly label: string;
  readonly points: number;
  readonly share: number;
}

export interface Insight {
  readonly id: string;
  readonly tone: "info" | "warning";
  readonly title: string;
  readonly body: string;
  readonly session?: BreakdownSession;
}

export interface LimitInsights {
  readonly totalCostUsd: number;
  readonly forecast: LimitForecast;
  readonly projects: readonly ProjectShare[];
  readonly chats: readonly ChatShare[];
  readonly models: readonly ModelShare[];
  /** Used share at the end of every hour since the window opened, for the burn chart. */
  readonly cumulative: readonly { readonly atMs: number; readonly used: number }[];
  readonly insights: readonly Insight[];
}

/** One entry per session across environments; two servers on one machine read the same files. */
export function mergeBreakdownSessions(
  answers: readonly { environmentId: EnvironmentId; sessions: readonly UsageBreakdownSession[] }[],
): BreakdownSession[] {
  const byKey = new Map<string, BreakdownSession>();
  for (const { environmentId, sessions } of answers) {
    for (const session of sessions) {
      const key = `${session.provider}:${session.sessionId}`;
      const previous = byKey.get(key);
      if (
        !previous ||
        (!previous.threadId && session.threadId) ||
        (Boolean(previous.threadId) === Boolean(session.threadId) &&
          session.costUsd > previous.costUsd)
      ) {
        byKey.set(key, { ...session, environmentId });
      }
    }
  }
  return [...byKey.values()];
}

// Paths are compared with forward slashes, so Windows folders match too.
const TEMP_DIRECTORY =
  /^(\/private)?\/tmp(\/|$)|^\/var\/folders\/|^\/private\/var\/folders\/|\/AppData\/Local\/Temp(\/|$)/i;

/**
 * Codex app chats run in a scratch folder under `~/Documents/Codex/`, or in a
 * ChatGPT project mounted under `~/.codex/.chatgpt-projects/`.
 */
const CODEX_APP_FOLDER = /\/Documents\/Codex\/|\/\.codex\/\.chatgpt-projects\//;

/** What to call a session's project: the T3 project, else its folder. */
export function projectLabelOf(session: UsageBreakdownSession): string {
  if (session.projectTitle) return session.projectTitle;
  if (!session.cwd) return "Unknown folder";
  const cwd = session.cwd.replaceAll("\\", "/");
  if (CODEX_APP_FOLDER.test(`${cwd}/`)) return "Codex app chats";
  if (TEMP_DIRECTORY.test(cwd)) return "Temporary folder";
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? session.cwd;
}

/** The client a session outside T3 came from, in words. */
export function originLabel(session: UsageBreakdownSession): string | null {
  if (session.threadId !== undefined) return null;
  const origin = session.origin?.toLowerCase() ?? "";
  if (origin.includes("desktop")) return session.provider === "codex" ? "Codex app" : "Desktop app";
  if (origin === "codex_exec") return "codex exec";
  if (origin.startsWith("codex")) return "Codex CLI";
  if (origin === "cli") return "Claude CLI";
  if (origin.startsWith("sdk")) return "Agent SDK";
  return "Outside T3";
}

/** Placeholder entries such as Claude's `<synthetic>` carry no real usage. */
function isRealModel(model: { readonly model: string; readonly costUsd: number }): boolean {
  return model.costUsd > 0 && !model.model.startsWith("<");
}

/** `claude-opus-4-6` → `Opus 4.6`; anything else stays as the provider names it. */
export function modelLabel(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (claude) {
    const family = claude[1]!;
    return `${family[0]!.toUpperCase()}${family.slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  }
  return model;
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function computeLimitInsights(
  window: LimitWindowInput,
  sessions: readonly BreakdownSession[],
): LimitInsights {
  const { usedPercent, startMs, resetsAtMs, nowMs } = window;
  const inWindow = (ms: number) => ms >= startMs && ms < nowMs;

  // Hour totals across sessions, clipped to the window.
  const hourCost = new Map<number, number>();
  let totalCostUsd = 0;
  for (const session of sessions) {
    for (const hour of session.hours) {
      const at = Date.parse(hour.hourStart);
      if (!inWindow(at + HOUR - 1) && !inWindow(at)) continue;
      hourCost.set(at, (hourCost.get(at) ?? 0) + hour.costUsd);
      totalCostUsd += hour.costUsd;
    }
  }
  const toPoints = (cost: number) => (totalCostUsd > 0 ? (cost / totalCostUsd) * usedPercent : 0);

  // Forecast. The rate blends the whole window's average with the last day,
  // so a burst shows up quickly without one quiet night reading as "safe".
  const elapsedHours = Math.max((nowMs - startMs) / HOUR, 1 / 60);
  const hoursLeft = Math.max((resetsAtMs - nowMs) / HOUR, 0);
  const averagePerHour = usedPercent / elapsedHours;
  let last24hCost = 0;
  let todayCost = 0;
  const todayStart = Math.max(startOfLocalDay(nowMs), startMs);
  for (const [at, cost] of hourCost) {
    if (at >= nowMs - DAY) last24hCost += cost;
    if (at + HOUR > todayStart) todayCost += cost;
  }
  const last24h = elapsedHours >= 24 && totalCostUsd > 0 ? toPoints(last24hCost) : null;
  const ratePerHour = last24h === null ? averagePerHour : (averagePerHour + last24h / 24) / 2;
  const projectedUsedAtReset = usedPercent + ratePerHour * hoursLeft;
  const remaining = Math.max(0, 100 - usedPercent);
  const runsOutAtMs =
    projectedUsedAtReset > 100 && ratePerHour > 0 ? nowMs + (remaining / ratePerHour) * HOUR : null;
  const forecast: LimitForecast = {
    status:
      elapsedHours < EARLY_HOURS
        ? "early"
        : runsOutAtMs !== null
          ? "runsOut"
          : projectedUsedAtReset >= 85
            ? "tight"
            : "onTrack",
    projectedUsedAtReset,
    runsOutAtMs,
    dailyBudget: hoursLeft > 0 ? remaining / Math.max(1, hoursLeft / 24) : 0,
    averagePerDay: averagePerHour * 24,
    last24h,
    today: totalCostUsd > 0 ? toPoints(todayCost) : null,
    ratePerHour,
  };

  // Per-session totals inside the window.
  const sessionStats = sessions.flatMap((session) => {
    let cost = 0;
    let responses = 0;
    let lastActiveMs = 0;
    for (const hour of session.hours) {
      const at = Date.parse(hour.hourStart);
      if (!inWindow(at + HOUR - 1) && !inWindow(at)) continue;
      cost += hour.costUsd;
      responses += hour.records;
      lastActiveMs = Math.max(lastActiveMs, Math.min(at + HOUR, nowMs));
    }
    return cost > 0 ? [{ session, cost, responses, lastActiveMs }] : [];
  });

  // Chats: a thread that started over keeps several provider sessions; show it once.
  type MutableChat = {
    -readonly [K in keyof Omit<ChatShare, "points" | "share">]: ChatShare[K];
  } & { cost: number; topCost: number };
  const chatMap = new Map<string, MutableChat>();
  for (const { session, cost, responses, lastActiveMs } of sessionStats) {
    const key = session.threadId
      ? `${session.environmentId}:thread:${session.threadId}`
      : `${session.environmentId}:${session.provider}:${session.sessionId}`;
    const models = session.models.filter(isRealModel).map((model) => modelLabel(model.model));
    const chat = chatMap.get(key);
    if (!chat) {
      chatMap.set(key, {
        key,
        session,
        title: session.title ?? "Untitled session",
        projectLabel: projectLabelOf(session),
        origin: originLabel(session),
        outsideT3: session.threadId === undefined,
        lastActiveMs,
        models: [...new Set(models)],
        responses,
        cost,
        topCost: cost,
      });
      continue;
    }
    chat.cost += cost;
    chat.responses += responses;
    chat.lastActiveMs = Math.max(chat.lastActiveMs, lastActiveMs);
    chat.models = [...new Set([...chat.models, ...models])];
    if (cost > chat.topCost) {
      chat.topCost = cost;
      chat.session = session;
    }
  }
  const chats: ChatShare[] = [...chatMap.values()]
    .map(({ cost, topCost: _topCost, ...chat }) => {
      const points = toPoints(cost);
      return {
        ...chat,
        points,
        share: totalCostUsd > 0 ? cost / totalCostUsd : 0,
      };
    })
    .sort((left, right) => right.points - left.points);

  const projectMap = new Map<string, { label: string; points: number; chats: number }>();
  for (const chat of chats) {
    const key = chat.session.projectId ?? `folder:${chat.projectLabel}`;
    const entry = projectMap.get(key) ?? { label: chat.projectLabel, points: 0, chats: 0 };
    entry.points += chat.points;
    entry.chats += 1;
    projectMap.set(key, entry);
  }
  const projects = [...projectMap]
    .map(([key, entry]) => ({
      key,
      ...entry,
      share: usedPercent > 0 ? entry.points / usedPercent : 0,
    }))
    .sort((left, right) => right.points - left.points);

  // Models, by each session's model mix.
  const modelMap = new Map<string, number>();
  for (const { session, cost } of sessionStats) {
    const models = session.models.filter(isRealModel);
    const sessionCost = models.reduce((sum, model) => sum + model.costUsd, 0);
    for (const model of models) {
      const label = modelLabel(model.model);
      const part = sessionCost > 0 ? model.costUsd / sessionCost : 0;
      modelMap.set(label, (modelMap.get(label) ?? 0) + toPoints(cost) * part);
    }
  }
  const models = [...modelMap]
    .map(([label, points]) => ({
      label,
      points,
      share: usedPercent > 0 ? points / usedPercent : 0,
    }))
    .filter((model) => model.points > 0)
    .sort((left, right) => right.points - left.points);

  // Burn-down: used share at the end of every hour so far.
  const cumulative: { atMs: number; used: number }[] = [{ atMs: startMs, used: 0 }];
  let running = 0;
  const firstHour = startMs - (startMs % HOUR);
  for (let at = firstHour; at < nowMs; at += HOUR) {
    running += toPoints(hourCost.get(at) ?? 0);
    cumulative.push({ atMs: Math.min(at + HOUR, nowMs), used: running });
  }
  // Usage the transcripts did not see (another computer, the web app) still
  // counts: when nothing was seen, draw the reported share as an even ramp.
  if (totalCostUsd === 0 && usedPercent > 0) {
    cumulative.splice(1, cumulative.length, { atMs: nowMs, used: usedPercent });
  }

  return {
    totalCostUsd,
    forecast,
    projects,
    chats,
    models,
    cumulative,
    insights: buildInsights(usedPercent, forecast, chats, projects),
  };
}

function formatPoints(points: number): string {
  return points >= 10 ? `${Math.round(points)}%` : `${points.toFixed(1)}%`;
}

function buildInsights(
  usedPercent: number,
  forecast: LimitForecast,
  chats: readonly ChatShare[],
  projects: readonly ProjectShare[],
): Insight[] {
  const insights: Insight[] = [];
  if (usedPercent < 1 || chats.length === 0) return insights;

  if (forecast.status === "tight" || forecast.status === "runsOut") {
    insights.push({
      id: "budget",
      tone: "warning",
      title: `Available per day until reset: ${formatPoints(forecast.dailyBudget)}`,
      body: `This spreads your remaining weekly allowance evenly until reset. You have averaged ${formatPoints(forecast.averagePerDay)} a day so far${
        forecast.last24h !== null
          ? ` and used ${formatPoints(forecast.last24h)} in the last 24 hours`
          : ""
      }.`,
    });
  }

  const top = chats[0]!;
  if (top.share >= 0.2 && chats.length > 1) {
    insights.push({
      id: "top-chat",
      tone: "info",
      title: `Largest chat: about ${formatPoints(top.points)} of your weekly limit`,
      body: `"${top.title}" in ${top.projectLabel}. This estimate is included in the ${formatPoints(usedPercent)} used this week.`,
      session: top.session,
    });
  }

  const outside = chats.filter((chat) => chat.outsideT3);
  const outsideShare = outside.reduce((sum, chat) => sum + chat.share, 0);
  if (outsideShare >= 0.1) {
    const byOrigin = new Map<string, number>();
    for (const chat of outside) {
      const origin = chat.origin ?? "Outside T3";
      byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + chat.points);
    }
    const sources = [...byOrigin]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([origin, points]) => `${origin} ≈${formatPoints(points)}`);
    insights.push({
      id: "outside",
      tone: "info",
      title: `Outside T3 Code: about ${formatPoints(outside.reduce((sum, chat) => sum + chat.points, 0))} of your weekly limit`,
      body: `${sources.join(", ")}. Included in the estimated usage below.`,
    });
  }

  const topProject = projects[0];
  if (topProject && projects.length > 1 && topProject.share >= 0.5) {
    insights.push({
      id: "top-project",
      tone: "info",
      title: `${topProject.label}: about ${formatPoints(topProject.points)} of your weekly limit`,
      body: `Estimated across ${topProject.chats} ${topProject.chats === 1 ? "chat" : "chats"}. Included in the ${formatPoints(usedPercent)} used this week.`,
    });
  }
  return insights;
}

export { formatPoints };

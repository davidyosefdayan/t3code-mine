/**
 * Personal build: Usage → Limits. The weekly forecast (will it last until the
 * reset?) leads; under it, where the week went, by project, model, and chat.
 */
import type { EnvironmentId, UsageProviderKind } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  formatDuration,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { useNavigate } from "@tanstack/react-router";
import { TerminalIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useUsageBreakdown } from "../../state/usage";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  PAGE_CARD_SURFACE,
  PageCard,
  PageMessage,
  PageSection,
  PageStat,
} from "../page/PageSection";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import {
  type ChatShare,
  computeLimitInsights,
  formatPoints,
  type LimitInsights,
  mergeBreakdownSessions,
} from "./limitInsights";
import { barColor, useLimitPresentations } from "./UsageLimits";
import { PoolSection, SegmentPopoverScope, UsageLimitsExtras } from "./UsageLimitsPooled";
import { STATUS, type WeeklyTarget, weeklyTargetOf } from "./weeklyLimit";

const HOUR = 60 * 60 * 1000;

/**
 * Categorical slots for projects, light and dark steps of one validated
 * palette. Assigned in fixed order; past six, projects fold into "Other".
 */
const PROJECT_COLORS = [
  "[--project-0:#2a78d6] dark:[--project-0:#3987e5]",
  "[--project-1:#eb6834] dark:[--project-1:#d95926]",
  "[--project-2:#1baf7a] dark:[--project-2:#199e70]",
  "[--project-3:#e87ba4] dark:[--project-3:#d55181]",
  "[--project-4:#4a3aa7] dark:[--project-4:#9085e9]",
  "[--project-5:#eda100] dark:[--project-5:#c98500]",
].join(" ");
const PROJECT_SLOTS = 6;
const projectColor = (index: number) =>
  index < PROJECT_SLOTS ? `var(--project-${index})` : "var(--muted-foreground)";

/**
 * One provider's week: the forecast, then where it went. Nothing when the
 * provider reports no weekly limit; its page then shows only its history.
 */
export function UsageProviderLimits({
  provider,
  selectedEnvironmentIds,
  now,
}: {
  /** Driver kind, such as `claudeAgent`. */
  readonly provider: string;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  /** Advanced on explicit refresh rather than ticking; a live clock would repaint for nothing. */
  readonly now: number;
}) {
  const selected = useLimitPresentations(selectedEnvironmentIds, NO_HIDDEN);
  const pool = collectLimitPools(collectLimitAccounts(selected), now).find(
    (candidate) => candidate.driver === provider,
  );
  if (!pool) return null;
  return (
    <div className={cn("flex flex-col gap-8", PROJECT_COLORS)}>
      <ProviderView pool={pool} now={now} selectedEnvironmentIds={selectedEnvironmentIds} />
    </div>
  );
}

const NO_HIDDEN: ReadonlySet<UsageProviderKind> = new Set();

/** Every provider's week at a glance; each card opens that provider's page. */
export function UsageLimitsOverview({
  selectedEnvironmentIds,
  now,
  onSelectProvider,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly now: number;
  readonly onSelectProvider: (driver: string) => void;
}) {
  const selected = useLimitPresentations(selectedEnvironmentIds, NO_HIDDEN);
  const pools = collectLimitPools(collectLimitAccounts(selected), now).filter(
    (pool) => weeklyTargetOf(pool) !== null,
  );
  return (
    <div className="flex flex-col gap-8">
      {pools.length > 0 ? (
        <PageSection title="This week">
          <div className="grid gap-3 sm:grid-cols-2">
            {pools.map((pool) => (
              <ProviderSummaryCard
                key={pool.driver}
                pool={pool}
                now={now}
                selectedEnvironmentIds={selectedEnvironmentIds}
                onSelect={() => onSelectProvider(pool.driver)}
              />
            ))}
          </div>
        </PageSection>
      ) : null}
      <UsageLimitsExtras presentations={selected} />
    </div>
  );
}

function ProviderSummaryCard({
  pool,
  now,
  selectedEnvironmentIds,
  onSelect,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelect: () => void;
}) {
  const target = weeklyTargetOf(pool);
  const { insights, isPending } = useWeeklyInsights(target, now, selectedEnvironmentIds);
  if (!target || !insights) return null;
  const { forecast } = insights;
  const session = pool.windows.find((window) => window.kind === "session");
  const color = barColor(pool.driver);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        PAGE_CARD_SURFACE,
        "flex cursor-pointer flex-col gap-3 px-3 py-3.5 text-start outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ProviderInstanceIcon
          driverKind={pool.driver}
          displayName={target.label}
          className="size-4"
          iconClassName="size-3.5"
        />
        {target.label}
      </span>
      <PageStat label="Left this week" value={`${target.window.remainingPercent}%`} />
      <span className="h-1.5 rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${target.window.remainingPercent}%`, backgroundColor: color }}
        />
      </span>
      <span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span
          className={cn(
            forecast.status === "runsOut" && "text-destructive-foreground",
            forecast.status === "tight" && "text-warning-foreground",
          )}
        >
          {isPending
            ? "\u00a0"
            : forecast.runsOutAtMs !== null
              ? `May run out ${formatWeekdayTime(forecast.runsOutAtMs)}`
              : STATUS[forecast.status].label}
        </span>
        {session ? (
          <span className="tabular-nums">5-hour: {session.remainingPercent}% left</span>
        ) : null}
      </span>
    </button>
  );
}

/** The weekly forecast and breakdown for one target; the overview and the provider tab share the query. */
function useWeeklyInsights(
  target: WeeklyTarget | null,
  now: number,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
) {
  // Read to the reset, not to now: one key for the whole week, so a revisit
  // reuses the saved answer instead of rescanning and redrawing.
  const breakdown = useUsageBreakdown(
    target?.kind
      ? {
          provider: target.kind,
          sinceTime: new Date(target.startMs).toISOString(),
          untilTime: new Date(target.resetsAtMs).toISOString(),
        }
      : null,
    selectedEnvironmentIds,
  );
  const insights = target
    ? computeLimitInsights(
        {
          usedPercent: target.window.usedPercent,
          startMs: target.startMs,
          resetsAtMs: target.resetsAtMs,
          nowMs: now,
        },
        mergeBreakdownSessions(breakdown.answers),
      )
    : null;
  return { insights, isPending: breakdown.isPending && breakdown.answers.length === 0 };
}

function nextResetIn(window: LimitPoolWindow, now: number): string {
  const next = window.resets[0];
  return next ? `Resets in ${formatDuration(next.at - now)}` : "";
}

function ProviderView({
  pool,
  now,
  selectedEnvironmentIds,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const target = weeklyTargetOf(pool);
  // The forecast card already lists every window; the full cards only add
  // something when there are several accounts or reset credits to act on.
  const showWindows =
    !target ||
    pool.accounts.length > 1 ||
    pool.accounts.some((account) => (account.limits.resetCredits?.availableCount ?? 0) > 0);
  return (
    <div className="flex flex-col gap-8">
      {target ? (
        <WeeklyLimitView
          pool={pool}
          target={target}
          now={now}
          selectedEnvironmentIds={selectedEnvironmentIds}
        />
      ) : null}
      {showWindows ? (
        <PageSection title={target ? "Accounts and reset credits" : "Limit windows"}>
          <SegmentPopoverScope pools={[pool]} now={now}>
            <PoolSection pool={pool} now={now} showHeading={false} />
          </SegmentPopoverScope>
        </PageSection>
      ) : null}
    </div>
  );
}

function WeeklyLimitView({
  pool,
  target,
  now,
  selectedEnvironmentIds,
}: {
  readonly pool: LimitPool;
  readonly target: WeeklyTarget;
  readonly now: number;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
}) {
  const { insights, isPending } = useWeeklyInsights(target, now, selectedEnvironmentIds);
  if (!insights) return null;
  const color = barColor(target.driver);

  return (
    <>
      <ForecastSection
        pool={pool}
        target={target}
        insights={insights}
        pending={isPending}
        color={color}
        now={now}
      />
      {target.kind === null ? null : (
        <PageSection
          title="Where it went"
          description={`Estimated shares of this week's limit since ${formatWeekday(target.startMs)}.`}
        >
          {isPending ? (
            <UsageBreakdownSkeleton />
          ) : insights.chats.length === 0 ? (
            <PageMessage>No {target.label} chats recorded this week.</PageMessage>
          ) : (
            <UsageBreakdown insights={insights} color={color} now={now} />
          )}
        </PageSection>
      )}
    </>
  );
}

/** The forecast in one sentence, shared by the overview card and the provider tab. */
function ForecastSentence({
  target,
  insights,
  now,
}: {
  readonly target: WeeklyTarget;
  readonly insights: LimitInsights;
  readonly now: number;
}) {
  const { forecast } = insights;
  if (forecast.status === "early") {
    return (
      <>
        <strong className="font-semibold text-foreground">{target.window.usedPercent}% used</strong>{" "}
        since the weekly reset {formatDuration(now - target.startMs)} ago. A usage forecast will be
        available after the first 24 hours.
      </>
    );
  }
  if (forecast.runsOutAtMs !== null) {
    return (
      <>
        At your current rate, you may reach the weekly limit on{" "}
        <strong className="font-semibold text-foreground">
          {formatWeekdayTime(forecast.runsOutAtMs)}
        </strong>
        , {formatDuration(target.resetsAtMs - forecast.runsOutAtMs)} before it resets.
      </>
    );
  }
  return (
    <>
      At your current rate, you are estimated to have{" "}
      <strong className="font-semibold text-foreground">
        {Math.max(0, Math.round(100 - forecast.projectedUsedAtReset))}% left
      </strong>{" "}
      when the limit resets.
    </>
  );
}

/** The forecast waits for the breakdown, so it never draws a guess and then redraws. */
function ForecastSection({
  pool,
  target,
  insights,
  pending,
  color,
  now,
}: {
  readonly pool: LimitPool;
  readonly target: WeeklyTarget;
  readonly insights: LimitInsights;
  readonly pending: boolean;
  readonly color: string;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const { forecast } = insights;
  const status = STATUS[forecast.status];
  const StatusIcon = status.icon;
  const otherWindows = pool.windows.filter((window) => window !== target.window);
  const estimate = (value: string) => (pending ? <Skeleton className="my-0.5 h-6 w-16" /> : value);

  return (
    <PageSection
      title={
        <>
          <ProviderInstanceIcon
            driverKind={target.driver}
            displayName={target.label}
            className="size-5"
            iconClassName="size-4 text-foreground/80"
          />
          {target.label} weekly limit
        </>
      }
      description={`Resets ${formatUpcomingTimestamp(
        new Date(target.resetsAtMs).toISOString(),
        timestampFormat,
        now,
      )}`}
      action={
        pending ? (
          <Skeleton shape="pill" className="h-5.5 w-32" />
        ) : (
          <Badge variant={status.variant} size="lg">
            <StatusIcon aria-hidden />
            {status.label}
          </Badge>
        )
      }
    >
      <PageCard>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
              <PageStat
                size="hero"
                label="Left this week"
                value={`${target.window.remainingPercent}%`}
              />
              {pending ? (
                <div className="flex w-80 max-w-full flex-col gap-1.5 py-0.5">
                  <Skeleton className="h-3.5" />
                  <Skeleton className="h-3.5 w-3/5" />
                </div>
              ) : (
                <p className="max-w-xl text-sm text-muted-foreground">
                  <ForecastSentence target={target} insights={insights} now={now} />
                </p>
              )}
            </div>
            {otherWindows.length > 0 ? (
              <ul className="flex w-full flex-col gap-2.5 rounded-lg bg-muted/50 p-3 md:w-64">
                {otherWindows.map((window) => (
                  <li key={`${window.kind}:${window.id}`} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">{window.label}</span>
                      <span className="font-medium text-foreground tabular-nums">
                        {window.remainingPercent}% left
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-2xs text-muted-foreground tabular-nums">
                      {nextResetIn(window, now)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {pending ? (
            <BurnChartSkeleton />
          ) : (
            <BurnChart target={target} insights={insights} color={color} now={now} />
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <PageStat
              label="Used today"
              value={estimate(forecast.today === null ? "–" : formatPoints(forecast.today))}
            />
            <PageStat
              label="Last 24 hours"
              value={estimate(forecast.last24h === null ? "–" : formatPoints(forecast.last24h))}
            />
            <PageStat
              label="Average per day"
              value={estimate(
                forecast.status === "early"
                  ? "After 24 hours"
                  : formatPoints(forecast.averagePerDay),
              )}
            />
            <PageStat
              label="Available per day"
              value={estimate(formatPoints(forecast.dailyBudget))}
            />
          </div>
        </div>
      </PageCard>
    </PageSection>
  );
}

/** Same footprint as `BurnChart`, so the real chart lands without moving anything. */
function BurnChartSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)]">
        <div />
        <Skeleton shape="card" className="h-44" />
        <div />
        <div className="mt-1.5 h-4" />
      </div>
    </div>
  );
}

/**
 * Share of the weekly limit used, from the window's start to its reset: the
 * filled line is what happened, the dashed diagonal is even spending, and the
 * dashed continuation is where the current pace lands.
 */
function BurnChart({
  target,
  insights,
  color,
  now,
}: {
  readonly target: WeeklyTarget;
  readonly insights: LimitInsights;
  readonly color: string;
  readonly now: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { startMs, resetsAtMs } = target;
  const span = resetsAtMs - startMs;
  const x = (ms: number) => ((ms - startMs) / span) * 1000;
  const y = (used: number) => 100 - Math.max(0, Math.min(100, used));
  const used = target.window.usedPercent;
  const { forecast } = insights;

  // Scale the seen usage so the line ends on the reported share; usage the
  // transcripts did not see is spread in proportion rather than dropped.
  const seen = insights.cumulative.at(-1)?.used ?? 0;
  const scale = seen > 0 ? used / seen : 0;
  const points = insights.cumulative.map((point) => ({ ...point, used: point.used * scale }));
  const line = points
    .map((point) => `${x(point.atMs).toFixed(2)},${y(point.used).toFixed(2)}`)
    .join(" L");
  const area = `M${x(startMs)},100 L${line} L${x(now).toFixed(2)},100 Z`;
  const projectionEnd =
    forecast.runsOutAtMs !== null
      ? { atMs: forecast.runsOutAtMs, used: 100 }
      : { atMs: resetsAtMs, used: forecast.projectedUsedAtReset };

  const days: number[] = [];
  const firstMidnight = new Date(startMs);
  firstMidnight.setHours(24, 0, 0, 0);
  for (let day = firstMidnight.getTime(); day < resetsAtMs;) {
    days.push(day);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    day = next.getTime();
  }

  const hoverMs = hover === null ? null : startMs + hover * span;
  const hoverUsed =
    hoverMs === null
      ? null
      : hoverMs <= now
        ? (points.toReversed().find((point) => point.atMs <= hoverMs)?.used ?? 0)
        : forecast.status === "early"
          ? null
          : Math.min(100, used + forecast.ratePerHour * ((hoverMs - now) / HOUR));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <LegendSwatch color={color}>Estimated weekly usage</LegendSwatch>
        {forecast.status === "early" ? null : (
          <LegendSwatch color={color} dashed>
            Projected usage
          </LegendSwatch>
        )}
        <LegendSwatch color="var(--muted-foreground)" dashed>
          Even weekly usage
        </LegendSwatch>
      </div>
      <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)]">
        <div className="relative h-44 text-2xs text-muted-foreground tabular-nums">
          {[100, 50, 0].map((tick) => (
            <span
              key={tick}
              className="absolute right-2 -translate-y-1/2"
              style={{ top: `${100 - tick}%` }}
            >
              {tick}%
            </span>
          ))}
        </div>
        <div
          className="relative h-44 cursor-crosshair"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            role="img"
            aria-label={`${used}% of the weekly limit used so far`}
          >
            {[25, 50, 75].map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={1000}
                y1={tick}
                y2={tick}
                stroke="var(--border)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={0}
              x2={1000}
              y1={0}
              y2={0}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.5}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              x2={1000}
              y1={100}
              y2={100}
              stroke="var(--border)"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              y1={100}
              x2={1000}
              y2={0}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.6}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
            <path d={area} fill={color} fillOpacity={0.14} />
            <path
              d={`M${line}`}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {forecast.status === "early" ? null : (
              <line
                x1={x(now)}
                y1={y(used)}
                x2={x(projectionEnd.atMs)}
                y2={y(projectionEnd.used)}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line
              x1={x(now)}
              x2={x(now)}
              y1={0}
              y2={100}
              stroke="var(--foreground)"
              strokeOpacity={0.25}
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null ? (
              <line
                x1={hover * 1000}
                x2={hover * 1000}
                y1={0}
                y2={100}
                stroke="var(--foreground)"
                strokeOpacity={0.4}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <span
            aria-hidden
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
            style={{ left: `${x(now) / 10}%`, top: `${y(used)}%`, backgroundColor: color }}
          />
          {forecast.runsOutAtMs !== null && forecast.status === "runsOut" ? (
            <span
              aria-hidden
              className={cn(
                "absolute -translate-y-full pb-1 text-2xs font-medium whitespace-nowrap text-destructive-foreground",
                x(forecast.runsOutAtMs) > 850 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${x(forecast.runsOutAtMs) / 10}%`, top: 0 }}
            >
              Limit reached {formatWeekdayTime(forecast.runsOutAtMs)}
            </span>
          ) : null}
          {hoverMs !== null && hoverUsed !== null && hover !== null ? (
            <div
              className={cn(
                "pointer-events-none absolute top-2 z-10 rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-xs shadow-md",
                hover > 0.6 ? "-translate-x-[calc(100%+8px)]" : "translate-x-2",
              )}
              style={{ left: `${hover * 100}%` }}
            >
              <div className="font-medium text-foreground">{formatWeekdayTime(hoverMs)}</div>
              <div className="text-muted-foreground tabular-nums">
                {hoverMs <= now ? "Estimated use" : "Projected use"} {Math.round(hoverUsed)}% · even
                pace {Math.round(((hoverMs - startMs) / span) * 100)}%
              </div>
            </div>
          ) : null}
        </div>
        <div />
        <div className="relative mt-1.5 h-4 text-2xs text-muted-foreground">
          {days.map((day) => (
            <span
              key={day}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${x(day) / 10}%` }}
            >
              {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(day)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({
  color,
  dashed = false,
  children,
}: {
  readonly color: string;
  readonly dashed?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg aria-hidden width="16" height="4" className="shrink-0">
        <line
          x1="0"
          x2="16"
          y1="2"
          y2="2"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 3" : undefined}
        />
      </svg>
      {children}
    </span>
  );
}

function UsageBreakdown({
  insights,
  color,
  now,
}: {
  readonly insights: LimitInsights;
  readonly color: string;
  readonly now: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ProjectsCard insights={insights} />
        <ModelsCard insights={insights} color={color} />
      </div>
      <ChatsCard insights={insights} color={color} now={now} />
    </div>
  );
}

function ProjectsCard({ insights }: { readonly insights: LimitInsights }) {
  const shown = insights.projects.slice(0, PROJECT_SLOTS);
  const rest = insights.projects.slice(PROJECT_SLOTS);
  const rows = [
    ...shown.map((project, index) => ({ ...project, color: projectColor(index) })),
    ...(rest.length > 0
      ? [
          {
            key: "other",
            label: `${rest.length} more`,
            points: rest.reduce((sum, project) => sum + project.points, 0),
            share: rest.reduce((sum, project) => sum + project.share, 0),
            chats: rest.reduce((sum, project) => sum + project.chats, 0),
            color: projectColor(PROJECT_SLOTS),
          },
        ]
      : []),
  ];
  const total = rows.reduce((sum, row) => sum + row.points, 0);
  return (
    <PageCard
      title="Usage by project"
      aside={`${insights.projects.length} ${insights.projects.length === 1 ? "project" : "projects"}`}
    >
      <div
        className="mb-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label="Relative estimated usage by project"
      >
        {rows.map((row) => (
          <div
            key={row.key}
            className="h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: `${(row.points / total) * 100}%`, backgroundColor: row.color }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 text-sm"
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="truncate text-foreground">{row.label}</span>
            <span className="w-14 text-end font-medium text-foreground tabular-nums">
              ≈{formatPoints(row.points)}
            </span>
          </li>
        ))}
      </ul>
    </PageCard>
  );
}

function ModelsCard({
  insights,
  color,
}: {
  readonly insights: LimitInsights;
  readonly color: string;
}) {
  const max = insights.models[0]?.points ?? 0;
  return (
    <PageCard title="Usage by model">
      <ul className="flex flex-col gap-3.5">
        {insights.models.slice(0, 6).map((model) => (
          <li key={model.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{model.label}</span>
              <span className="font-medium text-foreground tabular-nums">
                ≈{formatPoints(model.points)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${max > 0 ? (model.points / max) * 100 : 0}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </PageCard>
  );
}

const CHATS_PREVIEW = 8;

function ChatsCard({
  insights,
  color,
  now,
}: {
  readonly insights: LimitInsights;
  readonly color: string;
  readonly now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const chats = expanded ? insights.chats : insights.chats.slice(0, CHATS_PREVIEW);
  const max = insights.chats[0]?.points ?? 0;
  const projectIndex = new Map(insights.projects.map((project, index) => [project.label, index]));
  return (
    <PageCard
      flush
      title="Usage by chat"
      aside={`${insights.chats.length} ${insights.chats.length === 1 ? "chat" : "chats"} this week`}
    >
      <ol className="flex flex-col px-1.5 sm:px-2">
        {chats.map((chat, index) => (
          <ChatRow
            key={chat.key}
            chat={chat}
            rank={index + 1}
            max={max}
            color={color}
            projectColor={projectColor(
              Math.min(projectIndex.get(chat.projectLabel) ?? PROJECT_SLOTS, PROJECT_SLOTS),
            )}
            now={now}
          />
        ))}
      </ol>
      {insights.chats.length > CHATS_PREVIEW ? (
        <div className="px-1.5 pt-1 sm:px-2">
          <Button size="xs" variant="ghost" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show fewer" : `Show all ${insights.chats.length}`}
          </Button>
        </div>
      ) : null}
    </PageCard>
  );
}

function ChatRow({
  chat,
  rank,
  max,
  color,
  projectColor: dotColor,
  now,
}: {
  readonly chat: ChatShare;
  readonly rank: number;
  readonly max: number;
  readonly color: string;
  readonly projectColor: string;
  readonly now: number;
}) {
  const navigate = useNavigate();
  const threadId = chat.session.threadId;
  const content = (
    <>
      <span className="w-5 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
        {rank}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{chat.title}</span>
          {chat.outsideT3 ? (
            <Badge variant="outline" size="sm">
              <TerminalIcon aria-hidden />
              {chat.origin ?? "Outside T3"}
            </Badge>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
          />
          <span className="truncate">{chat.projectLabel}</span>
        </span>
      </span>
      <span className="hidden w-40 shrink-0 sm:block">
        <span className="block h-1.5 rounded-full bg-muted">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${max > 0 ? Math.max(2, (chat.points / max) * 100) : 0}%`,
              backgroundColor: color,
            }}
          />
        </span>
      </span>
      <span className="w-14 shrink-0 text-end text-sm font-semibold text-foreground tabular-nums">
        ≈{formatPoints(chat.points)}
      </span>
      <span className="hidden w-16 shrink-0 text-end text-xs text-muted-foreground tabular-nums md:block">
        {formatAgo(now - chat.lastActiveMs)}
      </span>
    </>
  );
  const className = "flex w-full items-center gap-3 rounded-lg px-1.5 py-2.5 text-start sm:px-2";
  return (
    <li>
      {threadId ? (
        <button
          type="button"
          className={cn(
            className,
            "cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId: chat.session.environmentId, threadId },
            })
          }
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

function UsageBreakdownSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton shape="card" className="h-56" />
        <Skeleton shape="card" className="h-56" />
      </div>
      <Skeleton shape="card" className="h-80" />
    </div>
  );
}

function formatWeekday(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(ms);
}

function formatWeekdayTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

function formatAgo(ms: number): string {
  if (ms < HOUR) return "just now";
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / (24 * HOUR))}d ago`;
}

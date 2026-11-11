/**
 * Personal build: the Usage rail icon's bars show each provider's weekly limit
 * left, in its color (left bar Claude, right bar Codex). The hover card turns a
 * provider amber or red when its week is tight or will run out.
 */
import type { ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { ChartColumnBigIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { computeLimitInsights, type ForecastStatus } from "./limitInsights";
import { barColor, useLimitPresentations } from "./UsageLimits";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { driverLabel, STATUS, weeklyTargetOf } from "./weeklyLimit";

export interface RailRing {
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly remainingPercent: number;
  readonly status: ForecastStatus;
  readonly runsOutAtMs: number | null;
}

/** Claude left, Codex right, then anything else; fixed so bars never swap places. */
const RING_ORDER: readonly string[] = [
  PROVIDER_PRESENTATION.claude.driverKind,
  PROVIDER_PRESENTATION.codex.driverKind,
];
const ringRank = (driver: string) => {
  const index = RING_ORDER.indexOf(driver);
  return index === -1 ? RING_ORDER.length : index;
};

/**
 * Reads the limits already on every client. The forecast here uses the week's
 * average pace only (no transcript scan), so the rail costs nothing to draw.
 */
export function useUsageRailRings(): readonly RailRing[] {
  return useUsageLimitSummaries().slice(0, 2);
}

const NO_HIDDEN = new Set<never>();

/** Every provider's weekly limit, Claude first, then Codex, then the rest. */
export function useUsageLimitSummaries(): readonly RailRing[] {
  const presentations = useLimitPresentations(null, NO_HIDDEN);
  const accounts = collectLimitAccounts(presentations);
  // As of the latest limits check, so the rail only redraws when limits refresh.
  const now = Math.max(0, ...accounts.map((account) => Date.parse(account.limits.checkedAt)));
  return collectLimitPools(accounts, now)
    .flatMap((pool): RailRing[] => {
      const target = weeklyTargetOf(pool);
      if (!target) return [];
      const { forecast } = computeLimitInsights(
        {
          usedPercent: target.window.usedPercent,
          startMs: target.startMs,
          resetsAtMs: target.resetsAtMs,
          nowMs: now,
        },
        [],
      );
      return [
        {
          driver: pool.driver,
          label: driverLabel(pool.driver),
          remainingPercent: target.window.remainingPercent,
          status: forecast.status,
          runsOutAtMs: forecast.status === "runsOut" ? forecast.runsOutAtMs : null,
        },
      ];
    })
    .toSorted((left, right) => ringRank(left.driver) - ringRank(right.driver));
}

const toneClass = (status: ForecastStatus) =>
  status === "runsOut"
    ? "text-destructive-foreground"
    : status === "tight"
      ? "text-warning-foreground"
      : undefined;

/** The chart icon's two bars, left then right. Equal heights, since each is one full week. */
const BARS = [
  { x: 7, y: 5, height: 12 },
  { x: 15, y: 5, height: 12 },
] as const;

/**
 * The chart icon, its bars holding each provider's week left in that
 * provider's color (left Claude, right Codex). The plain icon when no
 * provider reports a weekly limit.
 */
export function UsageRailIcon({
  rings,
  active,
}: {
  readonly rings: readonly RailRing[];
  /** On the Usage page the empty part of each bar fills with the outline's gray. */
  readonly active: boolean;
}) {
  if (rings.length === 0) return <ChartColumnBigIcon />;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      {BARS.map((bar, index) => {
        const ring = rings[index];
        const left = ring ? Math.max(0, Math.min(100, ring.remainingPercent)) / 100 : 0;
        // The fill covers the bar's stroke too, so a full bar reads as a solid bar.
        const outer = { x: bar.x - 1, y: bar.y - 1, height: bar.height + 2 };
        const fillHeight = outer.height * left;
        return (
          <g key={bar.x}>
            <rect
              x={bar.x}
              y={bar.y}
              width={4}
              height={bar.height}
              rx={1}
              opacity={0.4}
              className={cn(
                "stroke-sidebar-muted-foreground",
                active && "fill-sidebar-muted-foreground",
              )}
            />
            {ring && fillHeight > 0 ? (
              <path
                d={levelPath(outer.x, outer.y + outer.height, fillHeight)}
                stroke="none"
                style={{ fill: barColor(ring.driver) }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** A bar's fill, 6 wide: rounded at the bottom, flat on top so the level reads true. */
function levelPath(x: number, bottom: number, height: number): string {
  const r = Math.min(2, height);
  const top = bottom - height;
  return `M${x} ${top}H${x + 6}V${bottom - r}A${r} ${r} 0 0 1 ${x + 6 - r} ${bottom}H${x + r}A${r} ${r} 0 0 1 ${x} ${bottom - r}Z`;
}

function formatRunsOut(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function UsageRailTooltip({ rings }: { readonly rings: readonly RailRing[] }) {
  if (rings.length === 0) return <>Usage</>;
  return (
    <div className="flex w-56 flex-col gap-2 py-0.5">
      <span className="font-medium">Usage this week</span>
      {rings.map((ring, index) => (
        <div key={ring.driver} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              {ring.label}
              {rings.length > 1 ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {index === 0 ? "left bar" : "right bar"}
                </span>
              ) : null}
            </span>
            <span className={cn("shrink-0 tabular-nums", toneClass(ring.status))}>
              {ring.remainingPercent}% left
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full bg-current", toneClass(ring.status))}
              style={{ width: `${Math.max(0, Math.min(100, ring.remainingPercent))}%` }}
            />
          </div>
          <span className="text-muted-foreground">
            {ring.runsOutAtMs !== null
              ? `May run out ${formatRunsOut(ring.runsOutAtMs)}`
              : STATUS[ring.status].label}
          </span>
        </div>
      ))}
    </div>
  );
}

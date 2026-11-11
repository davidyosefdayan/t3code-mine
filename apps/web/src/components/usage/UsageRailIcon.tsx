/**
 * Personal build: the Usage rail icon's bars show each provider's weekly limit
 * left, in its color (left bar Claude, right bar Codex); hovering lists them.
 */
import type { ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { ChartColumnBigIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { barColor, useLimitPresentations } from "./UsageLimits";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { driverLabel, weeklyTargetOf } from "./weeklyLimit";

export interface RailRing {
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly remainingPercent: number;
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

/** Reads the limits already on every client, so the rail costs nothing to draw. */
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
      return [
        {
          driver: pool.driver,
          label: driverLabel(pool.driver),
          remainingPercent: target.window.remainingPercent,
        },
      ];
    })
    .toSorted((left, right) => ringRank(left.driver) - ringRank(right.driver));
}

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

export function UsageRailTooltip({ rings }: { readonly rings: readonly RailRing[] }) {
  if (rings.length === 0) return <>Usage</>;
  return (
    <div className="flex w-52 flex-col gap-2.5 py-0.5">
      <span className="font-medium">Usage</span>
      {rings.map((ring) => (
        <div key={ring.driver} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <ProviderInstanceIcon
                driverKind={ring.driver}
                displayName={ring.label}
                className="size-3.5"
                iconClassName="size-3.5"
              />
              <span className="truncate">{ring.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{ring.remainingPercent}%</span>
          </div>
          <div className="h-1 rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, ring.remainingPercent))}%`,
                backgroundColor: barColor(ring.driver),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

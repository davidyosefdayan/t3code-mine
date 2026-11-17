/**
 * Personal build: each provider's weekly limit left, for the rail's Usage hover
 * card, the top bar's usage chip and the Usage page's sidebar.
 */
import type { ServerProvider } from "@t3tools/contracts";
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";

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

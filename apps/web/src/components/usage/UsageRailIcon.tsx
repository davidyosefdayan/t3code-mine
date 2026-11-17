/**
 * Personal build: each provider's weekly limit left, for the rail's Usage hover
 * card, the top bar's usage chip and the Usage page's sidebar.
 */
import { collectLimitAccounts, collectLimitPools } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { T, useGT, useMessages } from "gt-react";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { barColor, PaceIcon, useLimitPresentations, usePaceMark } from "./UsageLimits";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { railRingOf, type RailRing } from "./weeklyLimit";

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
    .flatMap((pool) => {
      const ring = railRingOf(pool, now);
      return ring ? [ring] : [];
    })
    .toSorted((left, right) => ringRank(left.driver) - ringRank(right.driver));
}

export function UsageRailTooltip({ rings }: { readonly rings: readonly RailRing[] }) {
  if (rings.length === 0) return <T>Usage</T>;
  return (
    <div className="flex w-60 flex-col gap-3 py-0.5">
      <span className="font-medium">
        <T>Usage</T>
      </span>
      {rings.map((ring) => (
        <UsageRailTooltipRow key={ring.driver} ring={ring} />
      ))}
    </div>
  );
}

function UsageRailTooltipRow({ ring }: { readonly ring: RailRing }) {
  const gt = useGT();
  const m = useMessages();
  const { pace } = ring;
  const [barRef, paceMark] = usePaceMark(ring.timeLeftPercent);
  const resetsIn = ring.nextReset ? formatResetsIn(ring.nextReset, ring.now, m) : null;
  const paceText =
    pace === "ahead"
      ? gt("Using it faster than the week")
      : pace === "under"
        ? gt("Room to spare")
        : pace === "on"
          ? gt("On pace")
          : null;
  return (
    <div className="flex flex-col gap-1">
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
        <span className="shrink-0 tabular-nums">
          {gt("{remaining}% left", { remaining: ring.remainingPercent })}
        </span>
      </div>
      {/* The line marks where even spending would be by now. */}
      <div ref={barRef} className="relative h-3">
        <div className="absolute inset-0" style={paceMark?.gap}>
          <div className="absolute inset-x-0 inset-y-1 rounded-full bg-muted" />
          <div
            className="absolute inset-y-1 left-0 rounded-full"
            style={{
              width: `${Math.max(0, Math.min(100, ring.remainingPercent))}%`,
              backgroundColor: barColor(ring.driver),
            }}
          />
        </div>
        {paceMark ? (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={paceMark.tick}
          />
        ) : null}
      </div>
      {paceText || resetsIn ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {pace ? <PaceIcon pace={pace} /> : null}
          {paceText ? <span>{paceText}</span> : null}
          {resetsIn ? <span className="ms-auto shrink-0 tabular-nums">{resetsIn}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

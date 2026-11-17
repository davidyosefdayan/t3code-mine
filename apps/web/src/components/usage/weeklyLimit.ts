// Personal build: the weekly window a provider's forecast is about, shared by
// Usage → Limits and the Usage rail icon.
import type { ServerProvider, UsageProviderKind } from "@t3tools/contracts";
import type { LimitPool, LimitPoolWindow } from "@t3tools/shared/usageLimits";
import { AlertTriangleIcon, CheckCircle2Icon, CircleAlertIcon, Clock3Icon } from "lucide-react";

import { providerClients } from "../settings/providerDriverMeta";
import type { ForecastStatus } from "./limitInsights";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

const MINUTE = 60 * 1000;

/** Providers whose transcripts the server reads per session, so their week can be explained. */
const BREAKDOWN_KINDS: ReadonlySet<UsageProviderKind> = new Set(["claude", "codex", "grok"]);

function breakdownKindOf(driver: ServerProvider["driver"]): UsageProviderKind | null {
  const kind = PROVIDER_ORDER.find((entry) => PROVIDER_PRESENTATION[entry].driverKind === driver);
  return kind !== undefined && BREAKDOWN_KINDS.has(kind) ? kind : null;
}

export function driverLabel(driver: ServerProvider["driver"]): string {
  return providerClients.get(driver)?.label ?? String(driver);
}

/** Ids of the account-wide weekly window, ahead of model-scoped ones like `seven_day_opus`. */
const MAIN_WEEKLY_IDS = new Set(["seven_day", "secondary", "weekly"]);

export interface WeeklyTarget {
  readonly driver: ServerProvider["driver"];
  /** Null when the server cannot say which chats used it; the forecast still works. */
  readonly kind: UsageProviderKind | null;
  readonly label: string;
  readonly window: LimitPoolWindow;
  readonly startMs: number;
  readonly resetsAtMs: number;
}

export function weeklyTargetOf(pool: LimitPool): WeeklyTarget | null {
  const weekly = pool.windows.filter((window) => window.kind === "weekly");
  const window = weekly.find((candidate) => MAIN_WEEKLY_IDS.has(candidate.id)) ?? weekly[0];
  if (!window) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let resetsAtMs = 0;
  for (const member of window.members) {
    const resetsAt = member.window.resetsAt ? Date.parse(member.window.resetsAt) : Number.NaN;
    const minutes = member.window.windowDurationMins;
    if (!Number.isFinite(resetsAt) || !minutes) continue;
    startMs = Math.min(startMs, resetsAt - minutes * MINUTE);
    resetsAtMs = Math.max(resetsAtMs, resetsAt);
  }
  if (!Number.isFinite(startMs) || resetsAtMs === 0) return null;
  return {
    driver: pool.driver,
    kind: breakdownKindOf(pool.driver),
    label: driverLabel(pool.driver),
    window,
    startMs,
    resetsAtMs,
  };
}

/** Share left in the window the overview leads with: the weekly one when there is one. */
export function remainingOf(pool: LimitPool): number {
  return (weeklyTargetOf(pool)?.window ?? pool.windows[0])?.remainingPercent ?? 100;
}

export const STATUS: Record<
  ForecastStatus,
  {
    readonly label: string;
    readonly variant: "info" | "success" | "warning" | "error";
    readonly icon: typeof CheckCircle2Icon;
  }
> = {
  early: { label: "Forecast pending", variant: "info", icon: Clock3Icon },
  onTrack: { label: "On track", variant: "success", icon: CheckCircle2Icon },
  tight: { label: "High projected usage", variant: "warning", icon: CircleAlertIcon },
  runsOut: { label: "May reach limit before reset", variant: "error", icon: AlertTriangleIcon },
};

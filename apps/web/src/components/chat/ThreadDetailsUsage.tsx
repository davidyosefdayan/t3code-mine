import type {
  IdleCompactionMode,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  formatDuration,
  type LimitPace,
  limitsNotice,
  paceOf,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import type { IdleCompactionStatus } from "@t3tools/shared/idleCompactionStatus";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: "Ahead of pace",
  on: "On pace",
  under: "Under pace",
};

export interface ThreadDetailsUsageInput {
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly contextWindow: ContextWindowSnapshot | null;
}

type UsageTone = "error" | "warning" | null;

/** The selected provider's limit windows. Each row reads as room left. */
export function ThreadDetailsUsage({
  providerInstanceId,
  providers,
  sources,
}: Omit<ThreadDetailsUsageInput, "contextWindow">) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const report =
    providerInstanceId !== null
      ? collectProviderUsageLimits(providerInstanceId, providers, sources, now)
      : null;
  // Only this instance's data: the report keeps one instance per login, and any other entry may be
  // a different login or workspace, so fall back to the instance's own snapshot.
  const limits =
    report?.accounts.find((entry) => entry.instanceId === providerInstanceId)?.limits ??
    providers.find((provider) => provider.instanceId === providerInstanceId)?.usageLimits;
  if (!limits) return null;
  const notice = limitsNotice(limits);

  return (
    <ThreadDetailsSection
      headingId="thread-details-usage-heading"
      title="Usage limits"
      showHeading={false}
    >
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        {notice ? (
          <UsageRow
            label="Limits"
            fill={null}
            tone={null}
            value="Unavailable"
            tooltip={<span className="text-foreground">{notice}</span>}
          />
        ) : (
          limits.windows.map((window) => <LimitRow key={window.id} window={window} now={now} />)
        )}
      </div>
    </ThreadDetailsSection>
  );
}

/** Personal build: what idle compaction will do with this chat, shown under the context bar. */
export interface ThreadDetailsAutoCompact {
  readonly status: IdleCompactionStatus;
  readonly mode: IdleCompactionMode;
  /** When the prompt cache expires, and its lifetime, for the Cache bar. */
  readonly cacheEndMs: number | null;
  readonly cacheTtlMs: number | null;
  readonly onEnabledChange: (enabled: boolean) => void;
  /** This chat's compact limit in tokens; null follows the provider setting. */
  readonly window: number | null;
  /** The provider's "Auto-compact after", or null for Claude's default. */
  readonly defaultWindow: number | null;
  readonly onWindowChange: (window: number | null) => void;
}

const COMPACT_WINDOW_CHOICES = [600_000, 800_000, 1_000_000];
// Claude compacts this far short of the window (see ClaudeAdapterV2).
const CLAUDE_AUTO_COMPACT_RESERVE_TOKENS = 33_000;

/** The thread's context window. The bar fills as context is used; the tick marks auto-compaction. */
export function ThreadDetailsContext({
  usage,
  onCompact,
  autoCompact,
}: {
  readonly usage: ContextWindowSnapshot;
  /** Personal build: compacting from the card; omitted where the thread can't compact now. */
  readonly onCompact?: (() => void) | undefined;
  readonly autoCompact?: ThreadDetailsAutoCompact | undefined;
}) {
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  // Personal build: the chat's own limit shows at once, before Claude next reports it.
  const chatWindow = autoCompact?.window ?? null;
  const threshold =
    chatWindow !== null && (maxTokens === null || chatWindow < maxTokens)
      ? chatWindow - CLAUDE_AUTO_COMPACT_RESERVE_TOKENS
      : (usage.autoCompactThreshold ?? null);
  const tick =
    maxTokens !== null && threshold !== null && threshold > 0 && threshold < maxTokens
      ? (threshold / maxTokens) * 100
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  const shown = autoCompact !== undefined && autoCompact.status.type !== "unavailable";
  // Personal build: one section in two groups. Context: the bar, where Claude compacts it and
  // Compact now. Cache: its countdown and whether this chat compacts before it is lost.
  return (
    <>
      <ThreadDetailsSection
        headingId="thread-details-context-heading"
        title="Context window"
        showHeading={false}
      >
        <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
          <UsageRow
            label="Context"
            fill={used}
            tone={used === null ? null : used >= 90 ? "error" : used >= 80 ? "warning" : null}
            tick={tick}
            muted
            value={
              maxTokens !== null
                ? `${usedTokens} / ${formatContextWindowTokens(maxTokens)}`
                : usedTokens
            }
            ariaValue={used !== null ? `${used}% used` : `${usedTokens} tokens used`}
            tooltip={
              <>
                <span className="text-foreground">
                  {used !== null ? `Context: ${used}% used` : `Context: ${usedTokens} tokens used`}
                </span>
                {maxTokens !== null ? (
                  <span className="text-muted-foreground">
                    {usage.usedTokens.toLocaleString("en-US")} of{" "}
                    {maxTokens.toLocaleString("en-US")} tokens
                  </span>
                ) : null}
                {threshold !== null && threshold > 0 ? (
                  <span className="text-muted-foreground">
                    {formatContextWindowCompactionMessage(threshold)}
                  </span>
                ) : null}
              </>
            }
          />
        </div>
        {shown || onCompact !== undefined ? (
          <div className="flex items-center justify-between gap-1 pt-1.5 pr-2.5 [contain:inline-size]">
            {shown ? (
              <CompactWindowRow autoCompact={autoCompact} maxTokens={maxTokens} />
            ) : (
              <span />
            )}
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              disabled={onCompact === undefined}
              onClick={onCompact}
            >
              Compact now
            </Button>
          </div>
        ) : null}
        {shown ? <CacheRows autoCompact={autoCompact} /> : null}
      </ThreadDetailsSection>
    </>
  );
}

/** The prompt cache, and whether this chat compacts before it is lost. */
function CacheRows({ autoCompact }: { readonly autoCompact: ThreadDetailsAutoCompact }) {
  const { status, cacheEndMs, cacheTtlMs, mode } = autoCompact;
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const cacheLeftMs = cacheEndMs === null ? null : cacheEndMs - now;
  const cache =
    status.type === "working"
      ? { fill: null, value: "Active" }
      : cacheLeftMs === null
        ? { fill: null, value: "Unknown" }
        : cacheLeftMs > 0
          ? {
              fill:
                cacheTtlMs !== null && cacheTtlMs > 0
                  ? Math.round(Math.min(100, (cacheLeftMs / cacheTtlMs) * 100))
                  : null,
              value: `${formatDuration(cacheLeftMs)} left`,
            }
          : { fill: 0, value: "Expired" };
  const switchLabel =
    mode === "onReturn" ? "Compact when you return" : "Compact before cache expires";
  return (
    <div className="pt-2">
      <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 text-xs">
        <UsageRow
          label="Cache"
          fill={cache.fill}
          tone={null}
          muted
          value={cache.value}
          tooltip={
            <span className="text-foreground">
              {status.type === "working"
                ? "While the agent works, each step keeps the cache from expiring."
                : "Replies are cheaper and faster while the cache lasts."}
            </span>
          }
        />
      </div>
      <label className="flex h-6 cursor-pointer items-center justify-between gap-1.5 px-2.5 text-xs text-muted-foreground select-none">
        <span className="truncate">{switchLabel}</span>
        <Switch
          size="sm"
          disabled={mode === "off"}
          checked={mode !== "off" && status.type !== "off"}
          onCheckedChange={(checked) => autoCompact.onEnabledChange(checked)}
        />
      </label>
    </div>
  );
}

/** This chat's compact limit: the provider's, or a later one for a chat that should run longer. */
function CompactWindowRow({
  autoCompact: { window, defaultWindow, onWindowChange },
  maxTokens,
}: {
  readonly autoCompact: ThreadDetailsAutoCompact;
  readonly maxTokens: number | null;
}) {
  const defaultLabel =
    defaultWindow === null ? "Default" : `Default (${formatContextWindowTokens(defaultWindow)})`;
  const choices = COMPACT_WINDOW_CHOICES.filter(
    (choice) => choice === window || maxTokens === null || choice <= maxTokens,
  );
  if (window !== null && !choices.includes(window)) choices.unshift(window);
  if (choices.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-lg pr-1.5 pl-2.5 text-xs whitespace-nowrap outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08]"
          />
        }
      >
        <span className="shrink-0 text-muted-foreground">Compacts at</span>
        <span className="flex min-w-0 items-center gap-1 font-medium text-foreground/80 tabular-nums">
          <span className="truncate">
            {window !== null
              ? formatContextWindowTokens(window)
              : defaultWindow !== null
                ? formatContextWindowTokens(defaultWindow)
                : "Default"}
          </span>
          <ChevronDownIcon aria-hidden className="size-3 shrink-0" />
        </span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={window === null ? "default" : String(window)}
          onValueChange={(value) => onWindowChange(value === "default" ? null : Number(value))}
        >
          <MenuRadioItem value="default" closeOnClick>
            {defaultLabel}
          </MenuRadioItem>
          {choices.map((choice) => (
            <MenuRadioItem key={choice} value={String(choice)} closeOnClick>
              {formatContextWindowTokens(choice)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function LimitRow({
  window,
  now,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const left = remainingPercent(window);
  const pace = paceOf(window, now);
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
  return (
    <UsageRow
      label={window.label}
      fill={left}
      tone={left <= 10 ? "error" : left <= 20 ? "warning" : null}
      value={`${left}%`}
      ariaValue={`${left}% left`}
      tooltip={
        <>
          <span className="text-foreground">
            {window.label}: {left}% left
          </span>
          {window.resetsAt && resetsAt > now ? (
            <span className="text-muted-foreground">
              Resets in {formatDuration(resetsAt - now)} ·{" "}
              {formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)}
            </span>
          ) : null}
          {pace ? <span className="text-muted-foreground">{PACE_LABEL[pace]}</span> : null}
        </>
      }
    />
  );
}

/** One label, hairline, and value row; hovering it shows details. Personal build: no hover
 * fill, since the row isn't clickable. */
function UsageRow({
  label,
  fill,
  tone,
  tick = null,
  value,
  ariaValue = value,
  tooltip,
  muted = false,
}: {
  readonly label: string;
  /** Bar fill from 0 to 100. Null hides the bar. */
  readonly fill: number | null;
  readonly tone: UsageTone;
  /** A marker on the bar, from 0 to 100. */
  readonly tick?: number | null;
  readonly value: string;
  readonly ariaValue?: string;
  readonly tooltip: ReactNode;
  readonly muted?: boolean;
}) {
  const rowClassName =
    "col-span-3 grid h-6 cursor-default grid-cols-subgrid items-center rounded-lg px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const content = (
    <UsageRowContent
      label={label}
      fill={fill}
      tone={tone}
      tick={tick}
      value={value}
      muted={muted}
    />
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div tabIndex={0} aria-label={`${label}: ${ariaValue}`} className={rowClassName} />}
      >
        {content}
      </TooltipTrigger>
      {/* Rows sit 8px inside the card; clear its edge instead of overlapping it. */}
      <TooltipPopup side="left" sideOffset={16}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}

function UsageRowContent({
  label,
  fill,
  tone,
  tick,
  value,
  muted,
}: {
  readonly label: string;
  readonly fill: number | null;
  readonly tone: UsageTone;
  readonly tick: number | null;
  readonly value: string;
  readonly muted: boolean;
}) {
  return (
    <>
      <span className="max-w-28 truncate text-muted-foreground">{label}</span>
      {fill !== null ? (
        <span className="relative h-[3px] rounded-full bg-muted-foreground/30 dark:bg-muted-foreground/20">
          {fill > 0 ? (
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                tone === "error"
                  ? "bg-error"
                  : tone === "warning"
                    ? "bg-warning"
                    : muted
                      ? "bg-muted-foreground"
                      : "bg-foreground/80",
              )}
              style={{ width: `max(${fill}%, 6px)` }}
            />
          ) : null}
          {tick !== null ? (
            <span
              aria-hidden
              className="absolute -top-[3px] h-[9px] w-px -translate-x-1/2 bg-foreground/60"
              style={{ left: `${tick}%` }}
            />
          ) : null}
        </span>
      ) : null}
      <span
        className={cn(
          // Text-only rows span the bar column so they never widen the shared value column.
          "text-end font-medium tabular-nums",
          fill === null && "col-span-2",
          tone === "error"
            ? "text-error-foreground"
            : tone === "warning"
              ? "text-warning-foreground"
              : fill === null
                ? "text-muted-foreground"
                : "text-foreground/80",
        )}
      >
        {value}
      </span>
    </>
  );
}

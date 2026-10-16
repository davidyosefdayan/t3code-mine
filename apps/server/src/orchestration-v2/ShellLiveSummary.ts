/**
 * Personal build: small, stable summaries of a thread's latest reply and current
 * work step for its shell row. The sidebar shows them under each chat's title
 * and desktop notifications use the reply when a turn finishes.
 *
 * Shell deltas are skipped when a shell is unchanged, so everything here is
 * derived only from values that change when a message completes or the current
 * step changes, never from streaming text, tool output, or progress timestamps.
 */
import type {
  OrchestrationV2LatestVisibleMessageSummary,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const SHELL_MESSAGE_PREVIEW_MAX_CHARS = 240;
export const SHELL_LIVE_ACTIVITY_MAX_CHARS = 200;
const SHELL_LIVE_ACTIVITY_MAX_INPUT_KEYS = 8;
const SHELL_LIVE_ACTIVITY_MAX_PATTERNS = 3;

/** Cuts on a code point boundary and marks the cut with an ellipsis. */
export function truncateForShell(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars
    .slice(0, maxChars - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * The newest finished assistant reply of an unsettled, unarchived thread.
 * Reads the thread's own visible items, so rolled-back replies and replies
 * inherited from a fork parent are skipped, and skips streaming replies, so
 * the preview only changes when a reply completes.
 */
export function latestAssistantMessagePreview(projection: {
  readonly thread: Pick<
    OrchestrationV2ThreadProjection["thread"],
    "archivedAt" | "settledAt" | "settledOverride"
  >;
  readonly visibleTurnItems: OrchestrationV2ThreadProjection["visibleTurnItems"];
}): OrchestrationV2LatestVisibleMessageSummary | null {
  const { thread } = projection;
  if (thread.archivedAt !== null) return null;
  if (thread.settledAt !== null || thread.settledOverride === "settled") return null;
  for (let index = projection.visibleTurnItems.length - 1; index >= 0; index -= 1) {
    const row = projection.visibleTurnItems[index]!;
    if (row.visibility !== "local") continue;
    const item = row.item;
    if (item.type !== "assistant_message" || item.streaming) continue;
    const preview = assistantMessagePreview(
      item.messageId,
      item.text,
      item.completedAt ?? item.updatedAt,
    );
    if (preview !== null) return preview;
  }
  return null;
}

/** Shapes a finished reply's text into the shell preview; null when blank. */
export function assistantMessagePreview(
  id: OrchestrationV2LatestVisibleMessageSummary["id"],
  text: string,
  updatedAt: DateTime.Utc,
): OrchestrationV2LatestVisibleMessageSummary | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return {
    id,
    role: "assistant",
    text: truncateForShell(collapsed, SHELL_MESSAGE_PREVIEW_MAX_CHARS),
    updatedAt,
  };
}

type LiveStepItem = Extract<
  OrchestrationV2TurnItem,
  {
    readonly type:
      | "command_execution"
      | "file_change"
      | "file_search"
      | "web_search"
      | "dynamic_tool"
      | "subagent";
  }
>;

const LIVE_STEP_TYPES: ReadonlySet<OrchestrationV2TurnItem["type"]> = new Set([
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "subagent",
]);

function isLiveStep(item: OrchestrationV2TurnItem): item is LiveStepItem {
  // "waiting" steps wait on an approval, which the shell already reports as
  // a pending runtime request.
  return LIVE_STEP_TYPES.has(item.type) && (item.status === "running" || item.status === "pending");
}

function cut(text: string): string {
  return truncateForShell(text, SHELL_LIVE_ACTIVITY_MAX_CHARS);
}

/** A shallow copy of tool input that keeps only short primitive fields. */
function trimToolInput(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return typeof input === "string" ? cut(input) : null;
  }
  const trimmed: Record<string, string | number | boolean | null> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(input)) {
    if (kept >= SHELL_LIVE_ACTIVITY_MAX_INPUT_KEYS) break;
    if (typeof value === "string") trimmed[key] = cut(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null)
      trimmed[key] = value;
    else continue;
    kept += 1;
  }
  return trimmed;
}

function trimLiveStep(item: LiveStepItem, stableAt: DateTime.Utc): OrchestrationV2TurnItem {
  const base = {
    ...item,
    title: item.title === null ? null : cut(item.title),
    completedAt: null,
    updatedAt: stableAt,
  };
  switch (base.type) {
    case "command_execution": {
      const { output: _output, outputOmitted: _omitted, exitCode: _exit, ...rest } = base;
      return { ...rest, input: cut(base.input) };
    }
    case "file_change": {
      const {
        diffStr: _diff,
        oldStr: _old,
        newStr: _new,
        changes: _changes,
        additions: _additions,
        deletions: _deletions,
        ...rest
      } = base;
      return { ...rest, fileName: cut(base.fileName) };
    }
    case "file_search": {
      const { results: _results, ...rest } = base;
      return base.pattern === undefined ? rest : { ...rest, pattern: cut(base.pattern) };
    }
    case "web_search": {
      const { results: _results, ...rest } = base;
      return base.patterns === undefined
        ? rest
        : { ...rest, patterns: base.patterns.slice(0, SHELL_LIVE_ACTIVITY_MAX_PATTERNS).map(cut) };
    }
    case "dynamic_tool": {
      const { output: _output, outputOmitted: _omitted, ...rest } = base;
      return { ...rest, input: trimToolInput(base.input) };
    }
    case "subagent": {
      const { progress: _progress, ...rest } = base;
      return { ...rest, prompt: cut(base.prompt), result: null };
    }
  }
}

/**
 * The newest running or pending tool step of the thread's live runs, trimmed
 * to what a one-line status needs. `updatedAt` is pinned to the step's start
 * so progress updates (output, timestamps) leave the shell unchanged.
 */
export function liveActivityForShell(
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
  liveRuns: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "requestedAt">>,
): OrchestrationV2TurnItem | null {
  if (liveRuns.length === 0) return null;
  const runsById = new Map(liveRuns.map((run) => [run.id, run]));
  let newest: LiveStepItem | null = null;
  for (const item of turnItems) {
    if (item.runId === null || !runsById.has(item.runId) || !isLiveStep(item)) continue;
    if (newest === null || compareSteps(item, newest) > 0) newest = item;
  }
  if (newest === null) return null;
  const run = runsById.get(newest.runId!)!;
  return trimLiveStep(newest, newest.startedAt ?? run.requestedAt);
}

/** Trims one step already picked as the newest running one (the SQL shell
    path picks it in the query). Null when it is not a running step. */
export function liveActivityFromStep(
  item: OrchestrationV2TurnItem,
  fallbackAt: DateTime.Utc,
): OrchestrationV2TurnItem | null {
  return isLiveStep(item) ? trimLiveStep(item, item.startedAt ?? fallbackAt) : null;
}

/** The shell path's SQL keeps a prefix of the reply text; enough for a preview. */
export const SHELL_MESSAGE_PREVIEW_SQL_CHARS = 1_000;

function compareSteps(left: LiveStepItem, right: LiveStepItem): number {
  const leftStarted = left.startedAt === null ? null : DateTime.toEpochMillis(left.startedAt);
  const rightStarted = right.startedAt === null ? null : DateTime.toEpochMillis(right.startedAt);
  if (leftStarted !== null && rightStarted !== null && leftStarted !== rightStarted) {
    return leftStarted - rightStarted;
  }
  return left.ordinal - right.ordinal;
}

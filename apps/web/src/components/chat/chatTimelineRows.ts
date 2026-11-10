// Personal build: the chat-style conversation as a small pass over upstream's rows,
// so its folds and the "Tool calls in chat" setting apply. message_user calls become
// messages, a turn's last text is its answer bubble, and a working turn folds into one
// live line (the sidebar's words, liveWorkLine.ts) above a typing bubble.
import { workEntryMessageToUserText } from "@t3tools/client-runtime/work-log/presentation";
import { MessageId, RunId } from "@t3tools/contracts";

import { formatDuration, type TimelineEntry, type WorkLogEntry } from "../../session-logic";
import {
  deriveActiveVisualResponseRunIds,
  deriveMessagesTimelineRows,
  deriveTerminalAssistantMessageIds,
  deriveUnsettledRunId,
  groupOwnUserMessage,
  liveWorkEntryLabel,
  MESSAGE_TO_USER_ID_PREFIX,
  timelineTurnFoldRunIdsByEntryId,
  type MessagesTimelineRow,
  type MessagesTimelineRowsInput,
} from "./MessagesTimeline.logic";

type Row = MessagesTimelineRow;

export type ChatTimelineRowsInput = MessagesTimelineRowsInput & {
  /** Relative paths in the live line ("Reading src/bin.ts"). */
  readonly workspaceRoot?: string | undefined;
};

export const CHAT_TYPING_ROW_ID = "chat-typing-row";

function previewText(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.replace(/^[#>*\-\s]+/u, "").trim())
    .find((part) => part.length > 0);
  return (line ?? "").replace(/[*_`~]/gu, "").trim();
}

function isChatEventEntry(entry: WorkLogEntry): boolean {
  return entry.itemType === "notification" || entry.itemType === "system_notice";
}

/**
 * The chat's live line: what a working agent is doing now. The note it wrote
 * most recently, if that came after its latest step ("Checking how the zoom
 * bar loads"); otherwise the newest step still running ("Running git",
 * "Reading bin.ts"); otherwise "Thinking".
 */
export function chatLiveWorkLine(
  entries: ReadonlyArray<TimelineEntry>,
  workspaceRoot: string | undefined,
): string {
  let note: { text: string; at: string } | null = null;
  let step: WorkLogEntry | null = null;
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "assistant") {
      // A streaming note is still being written; its last full form is not known yet.
      const text = entry.message.streaming ? "" : previewText(entry.message.text);
      if (text) note = { text, at: entry.message.updatedAt };
      continue;
    }
    if (entry.kind !== "work") continue;
    const work = entry.entry;
    if (
      work.toolLifecycleStatus !== "inProgress" ||
      isChatEventEntry(work) ||
      work.sourceActivityKind === "context-compaction" ||
      work.itemType === "reasoning" ||
      workEntryMessageToUserText(work) !== null
    ) {
      continue;
    }
    step = work;
  }
  if (note && (!step || note.at >= step.createdAt)) return note.text;
  if (step) return liveWorkEntryLabel(step, workspaceRoot, true);
  return "Thinking";
}

const messagesToUser = new WeakMap<TimelineEntry, TimelineEntry>();

/** The agent's message_user calls, as the agent speaking. */
function withMessagesToUser(entries: ReadonlyArray<TimelineEntry>): ReadonlyArray<TimelineEntry> {
  return entries.map((entry) => {
    if (entry.kind !== "work") return entry;
    const cached = messagesToUser.get(entry);
    if (cached) return cached;
    const text = workEntryMessageToUserText(entry.entry);
    if (text === null) return entry;
    const message: TimelineEntry = {
      id: entry.id,
      kind: "message",
      createdAt: entry.createdAt,
      ...(entry.attempt === undefined ? {} : { attempt: entry.attempt }),
      message: {
        id: MessageId.make(`${MESSAGE_TO_USER_ID_PREFIX}${entry.entry.toolCallId ?? entry.id}`),
        role: "assistant",
        text,
        runId: entry.entry.runId ?? null,
        streaming: false,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
      },
    };
    messagesToUser.set(entry, message);
    return message;
  });
}

/** Which runs count as working, and which finished texts are answers. */
function chatTurnState(input: ChatTimelineRowsInput, entries: ReadonlyArray<TimelineEntry>) {
  const unsettledRunId = deriveUnsettledRunId(input.latestRun ?? null, input.runningRunId ?? null);
  const runlessActive = input.isWorking && input.runlessWorkActive === true;
  const activeRunIds = deriveActiveVisualResponseRunIds({
    timelineEntries: entries,
    unsettledRunId,
    isWorking: input.isWorking,
  });
  const terminalIds = deriveTerminalAssistantMessageIds(entries);
  /** A turn's last text, unless its own run is still working. */
  const isAnswer = (message: { id: MessageId; runId: RunId | null }) =>
    terminalIds.has(message.id) &&
    (message.runId === null
      ? !runlessActive
      : !input.isWorking || message.runId !== unsettledRunId);
  const isActive = (runId: RunId | null | undefined) =>
    runId == null ? runlessActive : activeRunIds.has(runId);
  return { terminalIds, isAnswer, isActive };
}

function isMessageToUser(row: Extract<Row, { kind: "message" }>): boolean {
  return row.message.id.startsWith(MESSAGE_TO_USER_ID_PREFIX);
}

/** Errors, events, questions and waiting approvals stay in view while the line folds the rest. */
function staysBesideLiveLine(row: Extract<Row, { kind: "work" }>, input: ChatTimelineRowsInput) {
  return row.groupedEntries.some((entry) => {
    const item = entry.projectedItem?.item;
    return (
      isChatEventEntry(entry) ||
      entry.tone === "error" ||
      entry.sourceActivityKind === "runtime.error" ||
      entry.itemType === "error" ||
      entry.itemType === "thread_created" ||
      entry.questionAnswer !== undefined ||
      (item?.type === "approval_request" &&
        input.pendingApprovalRequestIds?.has(item.requestId) === true)
    );
  });
}

function asBubble(row: Extract<Row, { kind: "message" }>, chat: "answer" | "to-user"): Row {
  return {
    ...row,
    chat,
    showAssistantMeta: true,
    showAssistantCopyButton: true,
    assistantCopyStreaming: row.message.streaming,
  };
}

/** Rows a "Worked for" fold shows when opened, so they sit on its rail. */
function openedFoldRowIds(rows: ReadonlyArray<Row>, input: ChatTimelineRowsInput) {
  const openRunIds = new Set(
    rows.flatMap((row) => (row.kind === "turn-fold" && row.expanded ? [row.runId] : [])),
  );
  if (openRunIds.size === 0) return null;
  const foldByEntryId = timelineTurnFoldRunIdsByEntryId(input);
  const ids = new Set<string>();
  for (const row of rows) {
    const entryId = row.id
      .replace(/^work-toggle:/u, "")
      .replace(/^work-group:(.*):details$/u, "$1");
    const runId = foldByEntryId.get(entryId);
    if (runId !== undefined && openRunIds.has(runId)) ids.add(row.id);
  }
  return ids;
}

function chatLiveLineId(input: Pick<ChatTimelineRowsInput, "latestRun" | "runningRunId">) {
  return `chat-work:${deriveUnsettledRunId(input.latestRun ?? null, input.runningRunId ?? null) ?? "runless"}`;
}

export function deriveChatTimelineRows(rawInput: ChatTimelineRowsInput): Row[] {
  const input = { ...rawInput, timelineEntries: withMessagesToUser(rawInput.timelineEntries) };
  const upstreamRows = deriveMessagesTimelineRows(input);
  const zen = input.toolCallVisibility === "zen";
  const { terminalIds, isAnswer, isActive } = chatTurnState(input, input.timelineEntries);
  const onRail = openedFoldRowIds(upstreamRows, input);
  const liveStart = input.isWorking ? upstreamRows.findIndex((row) => row.kind === "working") : -1;

  const rows: Row[] = [];
  let lineRows: Row[] = [];
  let stepCount = 0;
  // A steer splits the live turn: the work before it closes into its own line above
  // it, so the steer stays where it was sent and the live line covers what follows.
  let segmentStart = input.activeTurnStartedAt ?? null;
  let firstSegment = true;
  const closeSegmentBefore = (steer: Extract<Row, { kind: "message" }>) => {
    if (lineRows.length === 0) return;
    const runId = RunId.make(`${chatLiveLineId(input)}:before:${steer.message.id}`);
    const start = segmentStart ?? lineRows[0]?.createdAt ?? steer.message.createdAt;
    const elapsedMs = Date.parse(steer.message.createdAt) - Date.parse(start);
    const verb = firstSegment ? "Worked" : "Continued";
    const expanded = input.expandedRunIds?.has(runId) ?? false;
    rows.push({
      kind: "turn-fold",
      id: `turn-fold:${runId}`,
      createdAt: start,
      runId,
      label: Number.isFinite(elapsedMs) ? `${verb} for ${formatDuration(elapsedMs)}` : verb,
      expanded,
    });
    if (expanded) rows.push(...lineRows.map((row) => ({ ...row, chatStep: true })));
    lineRows = [];
    stepCount = 0;
    firstSegment = false;
    segmentStart = steer.message.createdAt;
  };
  // A compaction writes no answer: the line names it, and the typing bubble steps aside.
  let lineCompacting = false;
  let compacting = false;
  for (const [index, row] of upstreamRows.entries()) {
    // The bubble carries its own meta row.
    if (row.kind === "assistant-meta") continue;
    const inLiveTurn = liveStart >= 0 && index >= liveStart;
    if (inLiveTurn && (row.kind === "working" || row.kind === "thinking")) {
      if (row.kind === "working") lineCompacting = row.compacting === true;
      continue;
    }
    if (inLiveTurn && row.kind === "context-compaction" && row.active) compacting = true;
    if (row.kind === "message" && row.message.role === "user") {
      if (inLiveTurn) closeSegmentBefore(row);
      else segmentStart = input.activeTurnStartedAt ?? row.message.createdAt;
    }
    if (row.kind === "message" && row.message.role === "assistant") {
      if (isMessageToUser(row)) {
        rows.push(asBubble(row, "to-user"));
      } else if (zen || (inLiveTurn ? isAnswer(row.message) : terminalIds.has(row.message.id))) {
        rows.push(asBubble(row, "answer"));
      } else if (inLiveTurn) {
        lineRows.push(row);
        if (row.message.streaming || row.message.text.trim()) stepCount += 1;
      } else {
        rows.push(onRail?.has(row.id) ? { ...row, chatStep: true } : row);
      }
      continue;
    }
    const isWorkRow =
      row.kind === "work-live" ||
      row.kind === "work-toggle" ||
      row.kind === "attempt-fold" ||
      (row.kind === "work" && (row.isExpandedToolGroup || !staysBesideLiveLine(row, input)));
    if (inLiveTurn && !zen && isWorkRow) {
      lineRows.push(row);
      if (row.kind !== "work" || !row.isExpandedToolGroup) stepCount += 1;
      continue;
    }
    if (row.kind === "work" && row.groupedEntries.length === 1) {
      const [entry] = row.groupedEntries;
      if (entry && isChatEventEntry(entry)) {
        rows.push({ ...row, chat: "event" });
        continue;
      }
    }
    rows.push(onRail?.has(row.id) ? { ...row, chatStep: true } : row);
  }

  if (input.isWorking) {
    const turnEnded = input.latestRun?.turnEnded === true;
    if (liveStart >= 0 && !zen) {
      const id = chatLiveLineId(input);
      const label = chatLiveWorkLine(
        input.timelineEntries.filter(
          (entry) =>
            !(entry.kind === "message" && isAnswer(entry.message)) &&
            isActive(
              entry.kind === "message"
                ? entry.message.runId
                : entry.kind === "work"
                  ? entry.entry.runId
                  : null,
            ),
        ),
        input.workspaceRoot,
      );
      const expanded = input.expandedWorkGroupIds?.has(id) ?? false;
      rows.push({
        kind: "chat-work",
        id,
        createdAt: input.activeTurnStartedAt ?? null,
        label: turnEnded && label === "Thinking" ? "Waiting on background work" : label,
        expanded,
        stepCount,
        compacting: lineCompacting,
      });
      if (expanded) rows.push(...lineRows.map((row) => ({ ...row, chatStep: true })));
    }
    if (!turnEnded) {
      rows.push({
        kind: "chat-typing",
        id: CHAT_TYPING_ROW_ID,
        createdAt: input.activeTurnStartedAt ?? null,
        compacting: compacting || lineCompacting,
      });
    }
  }
  return rows.map((row, index) => groupOwnUserMessage(row, rows[index - 1], rows[index + 1]));
}

/** The live line folds a working turn's steps, so find opens it to show a match there. */
export function chatLiveLineIdHoldingEntry(
  rawInput: ChatTimelineRowsInput,
  entryId: string,
): string | undefined {
  if (!rawInput.isWorking || rawInput.toolCallVisibility === "zen") return undefined;
  const entries = withMessagesToUser(rawInput.timelineEntries);
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (entry?.kind !== "work" && !(entry?.kind === "message" && entry.message.role === "assistant"))
    return undefined;
  const { isAnswer, isActive } = chatTurnState(rawInput, entries);
  if (entry.kind === "message") {
    if (isAnswer(entry.message) || entry.message.id.startsWith(MESSAGE_TO_USER_ID_PREFIX)) {
      return undefined;
    }
    return isActive(entry.message.runId) ? chatLiveLineId(rawInput) : undefined;
  }
  return isActive(entry.entry.runId) ? chatLiveLineId(rawInput) : undefined;
}

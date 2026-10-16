// Personal build: the chat-style conversation. One rule shapes the agent's side:
//
//   Every time someone speaks (your message, a message you send mid-turn, your
//   answer to the agent's question, or the agent messaging you through
//   message_user), the agent's work up to that point closes into one
//   "Worked for …" line.
//
// Work is grouped by run, so a turn the agent starts on its own (a wake, a
// continuation) gets its own line. Within a line:
//   - steps (tool calls, thoughts, and notes the agent wrote along the way) hide
//     behind the line and open in place, one upstream step row each;
//   - cards and events (subagents, errors, notifications, compaction, pages,
//     plans) stay visible next to the line without splitting it;
//   - the run's last assistant message is its answer, a gray bubble after
//     everything else in the turn, once the run has stopped working.
// While the agent works, the newest line is live (it names the current step,
// see chatLiveWorkLine) and a typing bubble sits where the answer will appear.
import {
  contextCompactionTokenCounts,
  workEntryMessageToUserText,
} from "@t3tools/client-runtime/work-log/presentation";
import { hasQuestionAnswer } from "@t3tools/client-runtime/work-log/user-input";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import { MessageId, type RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  deriveRevertTurnCountByUserMessageId,
  formatDuration,
  type TimelineEntry,
  type WorkLogEntry,
} from "../../session-logic";
import type { ChatMessage, TurnDiffSummary } from "../../types";
import {
  computeMessageDurationStart,
  deriveActiveVisualResponseRunIds,
  deriveTerminalAssistantMessageIds,
  deriveUnsettledRunId,
  liveWorkEntryLabel,
  timelineRowEntries,
  workEntryIsVisibleInGroup,
  WORKTREE_SETUP_ROW_ID,
  type MessagesTimelineRow,
  type MessagesTimelineRowsInput,
} from "./MessagesTimeline.logic";

type Row = MessagesTimelineRow;
type MessageRow = Extract<Row, { kind: "message" }>;

export type ChatTimelineRowsInput = MessagesTimelineRowsInput & {
  /** Relative paths in the live line ("Reading src/bin.ts"). */
  readonly workspaceRoot?: string | undefined;
};

export const CHAT_TYPING_ROW_ID = "chat-typing-row";

const EMPTY_IDS: ReadonlySet<string> = new Set();

interface WorkBlock {
  /** Runs that are still working share one block, so a provider restart stays one line. */
  readonly key: string;
  readonly id: string;
  readonly startAt: string | null;
  endAt: string | null;
  /** Side rows that arrived before the first step sit above the line. */
  readonly leading: Row[];
  readonly steps: Array<{ readonly row: Row; readonly visible: boolean }>;
  readonly side: Row[];
  answer: MessageRow | null;
  runIds: Set<RunId>;
  compacting: boolean;
}

function entryRunId(entry: TimelineEntry): RunId | null {
  switch (entry.kind) {
    case "message":
      return entry.message.runId;
    case "work":
      return entry.entry.runId ?? null;
    case "event":
      return entry.projectedItem.item.runId;
    case "proposed-plan":
      return entry.proposedPlan.runId;
    case "html-render":
    case "mcp-app":
      return entry.runId;
  }
}

function entryEndAt(entry: TimelineEntry): string {
  if (entry.kind === "message") return entry.message.updatedAt;
  const item =
    entry.kind === "work"
      ? entry.entry.projectedItem?.item
      : entry.kind === "event"
        ? entry.projectedItem.item
        : undefined;
  const end = item?.completedAt ?? item?.updatedAt;
  return end ? DateTime.formatIso(end) : entry.createdAt;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function elapsedLabel(startAt: string | null, endAt: string | null): string | null {
  if (startAt === null || endAt === null) return null;
  const ms = Date.parse(endAt) - Date.parse(startAt);
  return Number.isFinite(ms) ? formatDuration(Math.max(0, ms)) : null;
}

/** Notifications and notices are things that happened, not the agent's work. */
function isChatEventEntry(entry: WorkLogEntry): boolean {
  return entry.itemType === "notification" || entry.itemType === "system_notice";
}

/** Errors stay visible as cards, like upstream keeps them out of folds. */
function isErrorEntry(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "error" ||
    entry.tone === "error" ||
    entry.sourceActivityKind === "runtime.error"
  );
}

function isCompactionEntry(entry: WorkLogEntry): boolean {
  return entry.sourceActivityKind === "context-compaction";
}

/** Your answer to a question the agent asked. A question still waiting on you stays its work. */
export function isQuestionReplyEntry(entry: WorkLogEntry): boolean {
  return entry.questionAnswer !== undefined && hasQuestionAnswer(entry.questionAnswer);
}

function previewText(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.replace(/^[#>*\-\s]+/u, "").trim())
    .find((part) => part.length > 0);
  return (line ?? "").replace(/[*_`~]/gu, "").trim();
}

/**
 * The chat's live line: what a working agent is doing now. The note it wrote
 * most recently, if that came after its latest step ("Checking how the zoom
 * bar loads"); otherwise the newest step still running ("Running git",
 * "Reading bin.ts"); otherwise "Thinking". Reads the working runs' own entries,
 * so a step a message of yours interrupted is still named.
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
      isCompactionEntry(work) ||
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

/** The agent's message_user call, shown as the agent speaking. */
function toUserMessage(entry: Extract<TimelineEntry, { kind: "work" }>, text: string): ChatMessage {
  return {
    id: MessageId.make(`to-user:${entry.entry.toolCallId ?? entry.id}`),
    role: "assistant",
    text,
    runId: entry.entry.runId ?? null,
    streaming: false,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
  };
}

/** Adjacent subagent cards from one provider turn render as one grouped card, like upstream. */
function groupSubagentCards(rows: ReadonlyArray<Row>): Row[] {
  const result: Row[] = [];
  for (const row of rows) {
    const previous = result.at(-1);
    if (
      row.kind === "event" &&
      row.projectedItem.item.type === "subagent" &&
      previous?.kind === "event" &&
      previous.projectedItem.item.type === "subagent" &&
      previous.projectedItem.item.runId === row.projectedItem.item.runId &&
      previous.projectedItem.item.providerTurnId === row.projectedItem.item.providerTurnId
    ) {
      result[result.length - 1] = {
        ...previous,
        subagents: [...(previous.subagents ?? [previous.projectedItem]), row.projectedItem],
      };
      continue;
    }
    result.push(row);
  }
  return result;
}

function deriveChatRows(
  input: ChatTimelineRowsInput,
  lineIdByEntryId: Map<string, string> | null,
): Row[] {
  const entries = timelineRowEntries(input.timelineEntries);
  const latestRun = input.latestRun ?? null;
  const unsettledRunId = deriveUnsettledRunId(latestRun, input.runningRunId ?? null);
  const activeRunIds = deriveActiveVisualResponseRunIds({
    timelineEntries: entries,
    unsettledRunId,
    isWorking: input.isWorking,
  });
  const runlessActive = input.isWorking && input.runlessWorkActive === true;
  const isActiveRun = (runId: RunId | null) =>
    runId === null ? runlessActive : activeRunIds.has(runId);
  const finalMessageIds = deriveTerminalAssistantMessageIds(entries);
  const expandedLineIds = input.expandedWorkGroupIds ?? EMPTY_IDS;

  const interruptedRunIds = new Set<RunId>();
  if (latestRun?.status === "interrupted") interruptedRunIds.add(latestRun.runId);
  for (const entry of entries) {
    if (
      entry.kind === "event" &&
      entry.projectedItem.item.type === "run_interrupt_result" &&
      entry.projectedItem.item.runId !== null
    ) {
      interruptedRunIds.add(entry.projectedItem.item.runId);
    }
  }

  const diffByMessageId = new Map<MessageId, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    if (summary.assistantMessageId) diffByMessageId.set(summary.assistantMessageId, summary);
  }
  const revertCounts = input.supportsConversationRollback
    ? deriveRevertTurnCountByUserMessageId({
        timelineEntries: entries,
        checkpoints: input.turnDiffSummaries,
        threadStartCheckpointReady: input.threadStartCheckpointReady === true,
        unsettledRunId,
        availableRevertTurnCounts: input.availableRevertTurnCounts,
      })
    : new Map<MessageId, number>();
  const durationStarts = computeMessageDurationStart(
    entries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : [])),
  );

  const messageRow = (
    entry: { id: string; createdAt: string; projectedItem?: MessageRow["projectedItem"] },
    message: ChatMessage,
    chat: MessageRow["chat"],
  ): MessageRow => {
    const shown = chat === "answer" || chat === "to-user";
    return {
      kind: "message",
      id: entry.id,
      createdAt: entry.createdAt,
      message,
      ...(entry.projectedItem === undefined ? {} : { projectedItem: entry.projectedItem }),
      durationStart: durationStarts.get(message.id) ?? message.createdAt,
      showAssistantMeta: shown,
      showAssistantCopyButton: shown,
      assistantCopyStreaming: message.streaming,
      assistantTurnDiffSummary: chat === "answer" ? diffByMessageId.get(message.id) : undefined,
      revertTurnCount: message.role === "user" ? revertCounts.get(message.id) : undefined,
      ...(chat === undefined ? {} : { chat }),
    };
  };

  const rows: Row[] = [];
  const usedLineIds = new Set<string>();
  // The last thing someone said; the first line after it starts there.
  // Typed through `as`: closures assign these, so control flow must not pin them to null.
  let opener = null as { id: string; createdAt: string; consumed: boolean } | null;
  let block = null as WorkBlock | null;

  const lineIdFor = (runId: RunId | null) => {
    const base = `chat-work:${runId ?? "runless"}:${opener?.id ?? "start"}`;
    let id = base;
    for (let suffix = 2; usedLineIds.has(id); suffix += 1) id = `${base}:${suffix}`;
    usedLineIds.add(id);
    return id;
  };

  const openBlock = (key: string, runId: RunId | null, at: string | null): WorkBlock => {
    const startAt = opener && !opener.consumed ? opener.createdAt : at;
    if (opener) opener.consumed = true;
    return {
      key,
      id: lineIdFor(runId),
      startAt,
      endAt: null,
      leading: [],
      steps: [],
      side: [],
      answer: null,
      runIds: new Set(runId === null ? [] : [runId]),
      compacting: false,
    };
  };

  const blockFor = (entry: TimelineEntry): WorkBlock => {
    const runId = entryRunId(entry);
    const key =
      runId === null
        ? runlessActive
          ? "active"
          : `runless:${opener?.id ?? "start"}`
        : isActiveRun(runId)
          ? "active"
          : runId;
    if (block?.key !== key) {
      closeBlock();
      block = openBlock(key, runId, entry.createdAt);
    }
    if (runId !== null) block.runIds.add(runId);
    block.endAt = laterIso(block.endAt, entryEndAt(entry));
    return block;
  };

  const pushSide = (entry: TimelineEntry, row: Row) => {
    const target = blockFor(entry);
    (target.steps.length === 0 ? target.leading : target.side).push(row);
  };

  const pushStep = (entry: TimelineEntry, row: Row, visible: boolean) => {
    const target = blockFor(entry);
    target.steps.push({ row, visible });
    lineIdByEntryId?.set(entry.id, target.id);
  };

  const emitSteps = (target: WorkBlock) => {
    const visible = target.steps.filter((step) => step.visible).map((step) => step.row);
    if (!expandedLineIds.has(target.id)) return;
    for (const [index, row] of visible.entries()) {
      const next = visible[index + 1];
      rows.push(
        row.kind === "work" && next?.kind === "work" ? { ...row, continuesWorkLog: true } : row,
      );
    }
  };

  const closeBlock = () => {
    const closing = block;
    if (!closing) return;
    block = null;
    rows.push(...groupSubagentCards(closing.leading));
    const stepCount = closing.steps.filter((step) => step.visible).length;
    if (stepCount > 0) {
      const end = laterIso(closing.endAt, closing.answer?.message.updatedAt ?? null);
      const duration = elapsedLabel(closing.startAt, end);
      const interrupted = [...closing.runIds].some((runId) => interruptedRunIds.has(runId));
      rows.push({
        kind: "chat-work",
        id: closing.id,
        createdAt: closing.startAt,
        label: interrupted
          ? duration
            ? `You stopped after ${duration}`
            : "You stopped this response"
          : duration
            ? `Worked for ${duration}`
            : "Worked",
        live: false,
        expanded: expandedLineIds.has(closing.id),
        stepCount,
        compacting: false,
      });
      emitSteps(closing);
    }
    rows.push(...groupSubagentCards(closing.side));
    if (closing.answer) rows.push(closing.answer);
  };

  const speak = (entry: TimelineEntry, row: Row) => {
    closeBlock();
    rows.push(row);
    opener = { id: entry.id, createdAt: entry.createdAt, consumed: false };
  };

  for (const entry of entries) {
    if (entry.kind === "message") {
      const { message } = entry;
      if (message.role === "user") {
        speak(entry, messageRow(entry, message, undefined));
        continue;
      }
      if (message.role !== "assistant") continue;
      const isAnswer = finalMessageIds.has(message.id) && !isActiveRun(message.runId);
      if (isAnswer) {
        const target = blockFor(entry);
        target.answer = messageRow(entry, message, "answer");
      } else {
        pushStep(
          entry,
          messageRow(entry, message, "note"),
          message.streaming || message.text.trim().length > 0,
        );
      }
      continue;
    }

    if (entry.kind === "work") {
      const work = entry.entry;
      if (isQuestionReplyEntry(work)) {
        speak(entry, { kind: "chat-reply", id: entry.id, createdAt: entry.createdAt, entry: work });
        continue;
      }
      const toUserText = workEntryMessageToUserText(work);
      if (toUserText !== null) {
        speak(entry, messageRow(entry, toUserMessage(entry, toUserText), "to-user"));
        continue;
      }
      const active = isActiveRun(work.runId ?? null) && work.toolLifecycleStatus === "inProgress";
      if (isCompactionEntry(work)) {
        if (active && input.isWorking) {
          // The live line carries a compaction in progress.
          blockFor(entry).compacting = true;
          continue;
        }
        const compaction = work.structuredPayload;
        pushSide(entry, {
          kind: "context-compaction",
          id: entry.id,
          createdAt: entry.createdAt,
          label: work.label,
          tokenCounts:
            compaction?.type === "compaction" ? contextCompactionTokenCounts(compaction) : null,
          active: false,
        });
        continue;
      }
      if (
        isChatEventEntry(work) ||
        isErrorEntry(work) ||
        work.itemType === "thread_created" ||
        // Like upstream, a question still waiting on you stays visible.
        work.questionAnswer !== undefined
      ) {
        pushSide(entry, {
          kind: "work",
          id: entry.id,
          createdAt: entry.createdAt,
          groupedEntries: [work],
          isExpandedToolGroup: false,
          ...(isChatEventEntry(work) ? { chat: "event" as const } : {}),
        });
        continue;
      }
      pushStep(
        entry,
        {
          kind: "work",
          id: entry.id,
          createdAt: entry.createdAt,
          groupedEntries: [work],
          isExpandedToolGroup: false,
          chat: "step",
        },
        workEntryIsVisibleInGroup(work, active),
      );
      continue;
    }

    if (entry.kind === "event") {
      // The interrupt result is the marker; the request only duplicates it.
      if (entry.projectedItem.item.type === "run_interrupt_request") continue;
      pushSide(entry, {
        kind: "event",
        id: entry.id,
        createdAt: entry.createdAt,
        projectedItem: entry.projectedItem,
      });
      continue;
    }

    if (entry.kind === "proposed-plan") {
      pushSide(entry, {
        kind: "proposed-plan",
        id: entry.id,
        createdAt: entry.createdAt,
        proposedPlan: entry.proposedPlan,
      });
      continue;
    }

    if (entry.kind === "html-render") {
      pushSide(entry, {
        kind: "html-render",
        id: entry.id,
        createdAt: entry.createdAt,
        htmlRender: entry.htmlRender,
      });
      continue;
    }

    pushSide(entry, {
      kind: "mcp-app",
      id: entry.id,
      createdAt: entry.createdAt,
      sourceThreadId: entry.sourceThreadId,
      itemId: entry.itemId,
      revision: entry.revision,
      mcpApp: entry.mcpApp,
    });
  }

  if (input.isWorking) {
    // Once the provider turn ended, background work (subagents) can keep the
    // run open, but the agent is no longer thinking or writing an answer.
    const turnEnded = latestRun?.turnEnded === true;
    const liveLabel = chatLiveWorkLine(
      entries.filter((entry) => isActiveRun(entryRunId(entry))),
      input.workspaceRoot,
    );
    const current: WorkBlock | null = block;
    let live: WorkBlock;
    if (current !== null && current.key === "active") {
      live = current;
      block = null;
    } else {
      closeBlock();
      live = openBlock(
        "active",
        input.runningRunId ?? unsettledRunId,
        input.activeTurnStartedAt ?? null,
      );
    }
    rows.push(...groupSubagentCards(live.leading));
    rows.push({
      kind: "chat-work",
      id: live.id,
      createdAt: live.startAt ?? input.activeTurnStartedAt ?? null,
      label: turnEnded && liveLabel === "Thinking" ? "Waiting on background work" : liveLabel,
      live: true,
      expanded: expandedLineIds.has(live.id),
      stepCount: live.steps.filter((step) => step.visible).length,
      compacting: live.compacting,
    });
    emitSteps(live);
    rows.push(...groupSubagentCards(live.side));
    if (!turnEnded) {
      rows.push({
        kind: "chat-typing",
        id: CHAT_TYPING_ROW_ID,
        createdAt: live.startAt,
        compacting: live.compacting,
      });
    }
  } else {
    closeBlock();
  }

  placeWorktreeSetup(rows, input);
  return rows;
}

/**
 * Like upstream: the setup card sits under the first message until the agent's
 * turn is live; a failed or cancelled setup stays so its actions remain reachable.
 */
function placeWorktreeSetup(rows: Row[], input: ChatTimelineRowsInput) {
  const setup = input.worktreeSetup;
  if (!setup) return;
  const handedOff = worktreeSetupAgentStarted(setup) && input.latestRun?.startedAt != null;
  if (handedOff && setup.phase === "running") return;
  const firstUserIndex = rows.findIndex(
    (row) => row.kind === "message" && row.message.role === "user",
  );
  rows.splice(firstUserIndex >= 0 ? firstUserIndex + 1 : rows.length, 0, {
    kind: "worktree-setup",
    id: WORKTREE_SETUP_ROW_ID,
    createdAt: setup.startedAt,
    snapshot: setup,
    embedded: handedOff,
  });
}

export function deriveChatTimelineRows(input: ChatTimelineRowsInput): Row[] {
  return deriveChatRows(input, null);
}

/** The work line that holds each step, so find can open the line around a match. */
export function chatWorkLineIdsByEntryId(
  input: ChatTimelineRowsInput,
): ReadonlyMap<string, string> {
  const lineIds = new Map<string, string>();
  deriveChatRows(input, lineIds);
  return lineIds;
}

// Personal build: the one line that says what a working chat is doing, shown
// in the sidebar row and meant for the chat's live line too, from the same
// thread shell so the two always agree. Like a messages app showing
// "typing…" instead of the old message: the agent's note from this turn
// ("Checking how the zoom bar loads"), or else the step it's on ("Running
// git"; the server keeps the newest step still running on the shell as
// `liveActivity`), or "Thinking" between steps. The previous turn's answer is
// stale, so it never shows.
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { deriveTimelineEntriesFromVisibleTurnItems } from "../session-logic";
import type { SidebarThreadSummary } from "../types";
import { liveWorkEntryLabel } from "./chat/MessagesTimeline.logic";
import { sidebarMessagePreview } from "./messagePreview";
import { resolveWorkingStartedAt } from "./Sidebar.logic";

export function liveWorkLine(
  thread: Pick<
    SidebarThreadSummary,
    "latestRun" | "runtime" | "latestVisibleMessage" | "liveActivity"
  >,
): string {
  const startedAt = resolveWorkingStartedAt(thread);
  const inThisTurn = (at: string | null | undefined): at is string =>
    !!at && (startedAt === null || at >= startedAt);
  const step = thread.liveActivity ?? null;
  const stepAt = step?.startedAt ? DateTime.formatIso(step.startedAt) : null;
  const message = thread.latestVisibleMessage;
  const noteAt = message?.role === "assistant" ? message.updatedAt : null;
  const note =
    inThisTurn(noteAt) && (stepAt === null || noteAt >= stepAt)
      ? sidebarMessagePreview(message?.text)
      : null;
  if (note) return note;
  if (step) return liveStepLabel(step);
  return "Thinking";
}

/** Names a running step the way the chat's work log does ("Running git",
    "Reading Sidebar.tsx"). */
export function liveStepLabel(item: OrchestrationV2TurnItem): string {
  const named =
    item.type === "command_execution" ? { ...item, input: closeCutQuote(item.input) } : item;
  const [entry] = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [
      {
        position: 0,
        visibility: "local",
        sourceThreadId: item.threadId,
        sourceItemId: item.id,
        item: named,
      },
    ],
    optimisticMessages: [],
  });
  if (entry?.kind === "work") return liveWorkEntryLabel(entry.entry, undefined, true);
  return item.title?.trim() || "Working";
}

// The server cuts the live step's strings short (ShellLiveSummary.ts), often
// inside a quoted argument, and an unclosed quote stops the command's program
// name from parsing ("Running command" instead of "Running sqlite3").
export function closeCutQuote(command: string): string {
  let open: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (open === null) {
      if (char === "\\") index += 1;
      else if (char === "'" || char === '"') open = char;
    } else if (open === '"' && char === "\\") {
      index += 1;
    } else if (char === open) {
      open = null;
    }
  }
  return open === null ? command : command + open;
}

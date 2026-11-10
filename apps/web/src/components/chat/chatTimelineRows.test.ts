import {
  MessageId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
  type ToolCallVisibility,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntriesFromVisibleTurnItems } from "../../session-logic";
import {
  CHAT_TYPING_ROW_ID,
  chatLiveLineIdHoldingEntry,
  chatLiveWorkLine,
  deriveChatTimelineRows,
} from "./chatTimelineRows";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

const threadId = ThreadId.make("thread-chat");
const runA = RunId.make("run-a");
const runB = RunId.make("run-b");
const at = (second: number) =>
  DateTime.makeUnsafe(new Date(Date.UTC(2026, 9, 1, 12, 0, second)).toISOString());
const iso = (second: number) => DateTime.formatIso(at(second));

let ordinal = 0;
const base = (id: string, second: number, runId: RunId | null, end = second) => ({
  id: TurnItemId.make(id),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: ProviderTurnId.make(`provider-${runId ?? "none"}`),
  nativeItemRef: null,
  parentItemId: null,
  ordinal: ordinal++,
  status: "completed" as const,
  title: null,
  startedAt: at(second),
  completedAt: at(end),
  updatedAt: at(end),
});

const user = (
  id: string,
  second: number,
  runId: RunId,
  inputIntent: "turn_start" | "steer" = "turn_start",
): OrchestrationV2TurnItem => ({
  ...base(id, second, runId),
  type: "user_message",
  messageId: MessageId.make(id),
  createdBy: "user",
  creationSource: "web",
  inputIntent,
  text: `Message ${id}`,
  attachments: [],
});

const assistant = (id: string, second: number, runId: RunId, text = `Reply ${id}`) =>
  ({
    ...base(id, second, runId),
    type: "assistant_message",
    messageId: MessageId.make(id),
    text,
    streaming: false,
  }) satisfies OrchestrationV2TurnItem;

const command = (id: string, second: number, runId: RunId, input = "ls", running = false) =>
  ({
    ...base(id, second, runId),
    ...(running ? { status: "running" as const, completedAt: null } : {}),
    type: "command_execution",
    input,
    output: running ? undefined : "ok",
    exitCode: running ? undefined : 0,
  }) satisfies OrchestrationV2TurnItem;

const thought = (id: string, second: number, runId: RunId) =>
  ({
    ...base(id, second, runId),
    type: "reasoning",
    text: "Checking the order first.",
    streaming: false,
  }) satisfies OrchestrationV2TurnItem;

const messageUser = (id: string, second: number, runId: RunId, message: string) =>
  ({
    ...base(id, second, runId),
    type: "dynamic_tool",
    toolName: "mcp__t3-code__message_user",
    input: { message },
    output: { content: [{ type: "text", text: '{"shown":true}' }] },
  }) satisfies OrchestrationV2TurnItem;

const compaction = (id: string, second: number, runId: RunId, running = false) =>
  ({
    ...base(id, second, runId),
    ...(running ? { status: "running" as const, completedAt: null } : {}),
    type: "compaction",
    driver: null,
  }) satisfies OrchestrationV2TurnItem;

const notification = (id: string, second: number, runId: RunId) =>
  ({
    ...base(id, second, runId),
    type: "notification",
    source: { kind: "command" },
    outcome: "completed",
    summary: "Background command finished",
  }) satisfies OrchestrationV2TurnItem;

const projected = (item: OrchestrationV2TurnItem): OrchestrationV2ProjectedTurnItem => ({
  position: item.ordinal,
  visibility: "local",
  sourceThreadId: threadId,
  sourceItemId: item.id,
  item,
});

function rowsFor(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  options: {
    readonly working?: RunId;
    /** The provider turn ended while background work keeps the run open. */
    readonly turnEnded?: boolean;
    readonly latest?: { runId: RunId; start: number; end: number };
    readonly expanded?: ReadonlyArray<string>;
    readonly expandedRuns?: ReadonlyArray<RunId>;
    readonly visibility?: ToolCallVisibility;
  } = {},
): MessagesTimelineRow[] {
  const timelineEntries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: items.map(projected),
    optimisticMessages: [],
  });
  return deriveChatTimelineRows({
    timelineEntries,
    latestRun: options.working
      ? {
          runId: options.working,
          status: "running",
          startedAt: iso(0),
          completedAt: null,
          ...(options.turnEnded ? { turnEnded: true } : {}),
        }
      : options.latest
        ? {
            runId: options.latest.runId,
            status: "completed",
            startedAt: iso(options.latest.start),
            completedAt: iso(options.latest.end),
          }
        : null,
    runningRunId: options.working ?? null,
    isWorking: options.working !== undefined,
    expandedWorkGroupIds: new Set(options.expanded ?? []),
    expandedRunIds: new Set(options.expandedRuns ?? []),
    ...(options.visibility ? { toolCallVisibility: options.visibility } : {}),
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  });
}

/** A compact picture of the rows: ids, plus what each chat row says. */
function shape(rows: ReadonlyArray<MessagesTimelineRow>) {
  return rows.map((row) => {
    const text = (() => {
      switch (row.kind) {
        case "chat-work":
          return `live: ${row.label}`;
        case "chat-typing":
          return "typing";
        case "turn-fold":
          return `line: ${row.label}`;
        case "message":
          return row.chat ? `${row.chat}: ${row.message.text}` : `${row.message.role}: ${row.id}`;
        case "work":
          return `${row.chat ?? "work"}: ${row.id}`;
        default:
          return `${row.kind}: ${row.id}`;
      }
    })();
    return row.chatStep ? `  ${text}` : text;
  });
}

describe("deriveChatTimelineRows", () => {
  it("folds a finished turn into upstream's line, with the answer as a bubble", () => {
    const items = [
      user("ask", 0, runA),
      thought("think", 1, runA),
      command("ls", 2, runA),
      assistant("note", 3, runA, "Looking at the config next."),
      command("grep", 4, runA, "grep -r foo"),
      assistant("answer", 9, runA, "All done."),
    ];
    const latest = { runId: runA, start: 0, end: 12 };
    expect(shape(rowsFor(items, { latest }))).toEqual([
      "user: ask",
      "line: Worked for 12s",
      "answer: All done.",
    ]);
    // Opened, upstream's step rows sit on the line's rail.
    const opened = shape(rowsFor(items, { latest, expandedRuns: [runA] }));
    expect(opened[0]).toBe("user: ask");
    expect(opened[1]).toBe("line: Worked for 12s");
    expect(opened.at(-1)).toBe("answer: All done.");
    expect(opened.slice(2, -1).length).toBeGreaterThan(0);
    expect(opened.slice(2, -1).every((row) => row.startsWith("  "))).toBe(true);
    expect(opened).toContain("  assistant: note");
  });

  it("keeps a working turn on one live line, with a typing bubble where the answer goes", () => {
    const items = [
      user("ask", 0, runA),
      command("ls", 1, runA),
      assistant("note", 2, runA, "Checked the folder."),
      command("tests", 3, runA, "vp test run", true),
    ];
    const rows = rowsFor(items, { working: runA });
    expect(shape(rows)).toEqual(["user: ask", "live: Running vp", "typing"]);
    expect(rows.at(-1)?.id).toBe(CHAT_TYPING_ROW_ID);
    const line = rows.find((row) => row.kind === "chat-work")!;
    expect(line).toMatchObject({ stepCount: 3 });

    const opened = shape(rowsFor(items, { working: runA, expanded: [line.id] }));
    expect(opened.slice(0, 2)).toEqual(["user: ask", "live: Running vp"]);
    expect(opened).toContain("  assistant: note");
    expect(opened.at(-1)).toBe("typing");
  });

  it("drops the line in Zen and keeps only the typing bubble", () => {
    const rows = rowsFor([user("ask", 0, runA), command("tests", 1, runA, "vp test run", true)], {
      working: runA,
      visibility: "zen",
    });
    expect(shape(rows)).toEqual(["user: ask", "typing"]);
  });

  it("drops the typing bubble once the turn ended, while background work keeps it live", () => {
    const rows = rowsFor([user("ask", 0, runA)], { working: runA, turnEnded: true });
    expect(shape(rows)).toEqual(["user: ask", "live: Waiting on background work"]);
  });

  it("starts a live line right after you send, before any work arrives", () => {
    const rows = rowsFor([user("ask", 0, runA)], { working: runA });
    expect(shape(rows)).toEqual(["user: ask", "live: Thinking", "typing"]);
  });

  it("stacks a steer under your message once the work between them folds into the line", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("build", 1, runA, "make build", true),
        user("more", 2, runA, "steer"),
      ],
      { working: runA },
    );
    expect(shape(rows)).toEqual(["user: ask", "user: more", "live: Running make", "typing"]);
    expect(rows.slice(0, 2)).toMatchObject([
      { kind: "message", groupedWithNext: true },
      { kind: "message", groupedWithPrevious: true },
    ]);
  });

  it("keeps the earlier answer an answer while the agent works again on its own", () => {
    const items = [
      user("ask", 0, runA),
      command("ls", 1, runA),
      assistant("answer-a", 4, runA, "Started the job."),
      command("log", 31, runB, "tail log", true),
    ];
    for (const visibility of ["showAll", "zen"] as const) {
      const rows = shape(rowsFor(items, { working: runB, visibility }));
      expect(rows).toContain("answer: Started the job.");
      expect(rows.at(-1)).toBe("typing");
    }
  });

  it("shows message_user as the agent speaking, which no fold hides", () => {
    const items = [
      user("ask", 0, runA),
      command("ls", 1, runA),
      messageUser("tell", 2, runA, "Found the bug; fixing it now."),
      command("fix", 3, runA, "apply patch", true),
    ];
    expect(shape(rowsFor(items, { working: runA }))).toEqual([
      "user: ask",
      "to-user: Found the bug; fixing it now.",
      "live: Running apply",
      "typing",
    ]);

    const settled = [
      ...items.slice(0, 3),
      command("fix", 3, runA, "apply patch"),
      assistant("answer", 6, runA, "Fixed."),
    ];
    for (const visibility of ["showAll", "hideAll", "zen"] as const) {
      const rows = shape(
        rowsFor(settled, { latest: { runId: runA, start: 0, end: 6 }, visibility }),
      ).filter((row) => !row.startsWith("line:"));
      expect(rows).toEqual([
        "user: ask",
        "to-user: Found the bug; fixing it now.",
        "answer: Fixed.",
      ]);
    }
  });

  it("gives every bubble its meta row, even when more work follows it in the turn", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        assistant("answer", 3, runA, "Here is my recommendation."),
        command("more", 4, runA, "git diff"),
      ],
      { latest: { runId: runA, start: 0, end: 5 } },
    );
    expect(rows.some((row) => row.kind === "assistant-meta")).toBe(false);
    expect(rows.find((row) => row.kind === "message" && row.chat === "answer")).toMatchObject({
      showAssistantMeta: true,
      showAssistantCopyButton: true,
    });
  });

  it("centers a job finishing as an event", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        notification("job-done", 2, runA),
        assistant("answer", 5, runA, "Done."),
      ],
      { latest: { runId: runA, start: 0, end: 5 } },
    );
    expect(shape(rows)).toContain("event: job-done");
  });

  it("names a running compaction on the live line and hides the typing bubble", () => {
    const live = rowsFor(
      [user("ask", 0, runA), command("ls", 1, runA), compaction("compact", 2, runA, true)],
      { working: runA },
    );
    expect(live.find((row) => row.kind === "chat-typing")).toMatchObject({ compacting: true });
  });

  it("opens the live line for find when it hides the match", () => {
    const items = [user("ask", 0, runA), command("ls", 1, runA, "ls", true)];
    const input = {
      timelineEntries: deriveTimelineEntriesFromVisibleTurnItems({
        visibleTurnItems: items.map(projected),
        optimisticMessages: [],
      }),
      latestRun: {
        runId: runA,
        status: "running" as const,
        startedAt: iso(0),
        completedAt: null,
      },
      runningRunId: runA,
      isWorking: true,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    };
    const lineId = deriveChatTimelineRows(input).find((row) => row.kind === "chat-work")?.id;
    expect(chatLiveLineIdHoldingEntry(input, "ls")).toBe(lineId);
    expect(chatLiveLineIdHoldingEntry(input, "ask")).toBeUndefined();
  });
});

describe("chatLiveWorkLine", () => {
  const entriesFor = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
    deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: items.map(projected),
      optimisticMessages: [],
    });

  it("names the newest running step, a newer note, or thinking", () => {
    expect(chatLiveWorkLine(entriesFor([command("ls", 1, runA, "git log", true)]), undefined)).toBe(
      "Running git",
    );
    expect(
      chatLiveWorkLine(
        entriesFor([
          command("ls", 1, runA, "git log", true),
          assistant("note", 2, runA, "## Checking the **zoom** bar\nmore"),
        ]),
        undefined,
      ),
    ).toBe("Checking the zoom bar");
    expect(chatLiveWorkLine(entriesFor([command("ls", 1, runA)]), undefined)).toBe("Thinking");
  });
});

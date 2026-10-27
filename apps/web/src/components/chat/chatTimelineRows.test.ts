import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntriesFromVisibleTurnItems } from "../../session-logic";
import {
  CHAT_TYPING_ROW_ID,
  chatLiveWorkLine,
  chatWorkLineIdsByEntryId,
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

const subagent = (id: string, second: number, runId: RunId) =>
  ({
    ...base(id, second, runId),
    status: "running",
    completedAt: null,
    type: "subagent",
    subagentId: NodeId.make(id),
    origin: "app_owned",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    childThreadId: ThreadId.make(`${id}-thread`),
    prompt: `Inspect ${id}`,
    result: null,
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

const question = (id: string, second: number, runId: RunId) =>
  ({
    ...base(id, second, runId),
    type: "user_input_request",
    requestId: RuntimeRequestId.make(`request-${id}`),
    questions: [],
    questionAnswer: {
      requestId: `request-${id}`,
      questionTextById: { pick: "Which file?" },
      answers: { pick: "bin.ts" },
      attachmentsByQuestionId: {},
    },
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
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  });
}

/** A compact picture of the rows: ids, plus what each chat row says. */
function shape(rows: ReadonlyArray<MessagesTimelineRow>) {
  return rows.map((row) => {
    switch (row.kind) {
      case "chat-work":
        return `${row.live ? "live" : "line"}: ${row.label}`;
      case "chat-typing":
        return "typing";
      case "chat-reply":
        return `reply: ${row.id}`;
      case "message":
        return row.chat ? `${row.chat}: ${row.message.text}` : `${row.message.role}: ${row.id}`;
      case "work":
        return row.chat === "event" ? `event: ${row.id}` : `${row.chat ?? "work"}: ${row.id}`;
      default:
        return `${row.kind}: ${row.id}`;
    }
  });
}

describe("deriveChatTimelineRows", () => {
  it("closes a finished turn into one line, with the answer last", () => {
    const items = [
      user("ask", 0, runA),
      thought("think", 1, runA),
      command("ls", 2, runA),
      assistant("note", 3, runA, "Looking at the config next."),
      command("grep", 4, runA, "grep -r foo"),
      assistant("answer", 9, runA, "All done."),
      // Work after the final text still folds into the line above the answer.
      command("check", 11, runA, "git status"),
    ];
    const rows = rowsFor(items, { latest: { runId: runA, start: 0, end: 12 } });
    expect(shape(rows)).toEqual(["user: ask", "line: Worked for 11s", "answer: All done."]);
    const line = rows.find((row) => row.kind === "chat-work")!;
    expect(line).toMatchObject({ stepCount: 5, expanded: false });

    const opened = rowsFor(items, {
      latest: { runId: runA, start: 0, end: 12 },
      expanded: [line.id],
    });
    expect(shape(opened)).toEqual([
      "user: ask",
      "line: Worked for 11s",
      "step: think",
      "step: ls",
      "note: Looking at the config next.",
      "step: grep",
      "step: check",
      "answer: All done.",
    ]);
  });

  it("keeps a working turn live, with no answer yet and a typing bubble", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        assistant("note", 2, runA, "Checked the folder."),
        command("tests", 3, runA, "vp test run", true),
      ],
      { working: runA },
    );
    expect(shape(rows)).toEqual(["user: ask", "live: Running vp", "typing"]);
    expect(rows.at(-1)?.id).toBe(CHAT_TYPING_ROW_ID);
    expect(rows.find((row) => row.kind === "chat-work")).toMatchObject({ stepCount: 3 });
  });

  it("drops the typing bubble once the turn ended, while background work keeps it live", () => {
    const rows = rowsFor([user("ask", 0, runA)], { working: runA, turnEnded: true });
    expect(shape(rows)).toEqual(["user: ask", "live: Waiting on background work"]);
  });

  it("starts a live line right after you send, before any work arrives", () => {
    const rows = rowsFor([user("ask", 0, runA)], { working: runA });
    expect(shape(rows)).toEqual(["user: ask", "live: Thinking", "typing"]);
  });

  it("closes the line when you steer, and keeps naming a step your message interrupted", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("build", 1, runA, "make build", true),
        user("steer", 5, runA, "steer"),
        thought("rethink", 6, runA),
      ],
      { working: runA },
    );
    expect(shape(rows)).toEqual([
      "user: ask",
      "line: Worked for 1.0s",
      "user: steer",
      "live: Running make",
      "typing",
    ]);
  });

  it("gives a wake its own line, and the earlier answer stays an answer", () => {
    const finished = [
      user("ask", 0, runA),
      command("ls", 1, runA),
      assistant("answer-a", 4, runA, "Started the job."),
      notification("wake", 30, runB),
      command("log", 31, runB, "tail log"),
      assistant("answer-b", 35, runB, "The job passed."),
    ];
    expect(shape(rowsFor(finished, { latest: { runId: runB, start: 30, end: 35 } }))).toEqual([
      "user: ask",
      "line: Worked for 4.0s",
      "answer: Started the job.",
      "event: wake",
      "line: Worked for 5.0s",
      "answer: The job passed.",
    ]);

    // While the woken run works, the first run's answer does not fold back into work.
    expect(shape(rowsFor(finished.slice(0, 5), { working: runB }))).toEqual([
      "user: ask",
      "line: Worked for 4.0s",
      "answer: Started the job.",
      "event: wake",
      "live: Thinking",
      "typing",
    ]);
  });

  it("shows a job finishing mid-turn as an event that does not split the line", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        notification("job-done", 2, runA),
        command("cat", 3, runA, "cat out.txt"),
        assistant("answer", 5, runA, "Done."),
      ],
      { latest: { runId: runA, start: 0, end: 5 } },
    );
    expect(shape(rows)).toEqual([
      "user: ask",
      "line: Worked for 5.0s",
      "event: job-done",
      "answer: Done.",
    ]);
  });

  it("keeps subagent cards as one grouped card next to the line", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        subagent("child-1", 2, runA),
        subagent("child-2", 3, runA),
        command("wait", 4, runA, "sleep 1"),
        assistant("answer", 8, runA, "Both are running."),
      ],
      { latest: { runId: runA, start: 0, end: 8 } },
    );
    expect(shape(rows)).toEqual([
      "user: ask",
      "line: Worked for 8.0s",
      "event: child-1",
      "answer: Both are running.",
    ]);
    expect(rows.find((row) => row.id === "child-1")).toMatchObject({
      subagents: [{ item: { id: "child-1" } }, { item: { id: "child-2" } }],
    });
  });

  it("shows message_user as the agent speaking, which closes the line and stays", () => {
    const items = [
      user("ask", 0, runA),
      command("ls", 1, runA),
      messageUser("tell", 2, runA, "Found the bug; fixing it now."),
      command("fix", 3, runA, "apply patch", true),
    ];
    expect(shape(rowsFor(items, { working: runA }))).toEqual([
      "user: ask",
      "line: Worked for 1.0s",
      "to-user: Found the bug; fixing it now.",
      "live: Running apply",
      "typing",
    ]);

    const settled = [
      ...items.slice(0, 3),
      command("fix", 3, runA, "apply patch"),
      assistant("answer", 6, runA, "Fixed."),
    ];
    expect(shape(rowsFor(settled, { latest: { runId: runA, start: 0, end: 6 } }))).toEqual([
      "user: ask",
      "line: Worked for 1.0s",
      "to-user: Found the bug; fixing it now.",
      "line: Worked for 4.0s",
      "answer: Fixed.",
    ]);
  });

  it("gives every bubble its meta row, even when more work follows it in the turn", () => {
    const bubbleMeta = (rows: ReadonlyArray<MessagesTimelineRow>, text: string) => {
      const row = rows.find(
        (candidate) => candidate.kind === "message" && candidate.message.text === text,
      );
      return row?.kind === "message"
        ? { showAssistantMeta: row.showAssistantMeta, copy: row.showAssistantCopyButton }
        : null;
    };
    // The agent messages you mid-turn, then keeps working.
    const told = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        messageUser("tell", 2, runA, "Here is my recommendation."),
        command("fix", 3, runA, "apply patch", true),
      ],
      { working: runA },
    );
    expect(bubbleMeta(told, "Here is my recommendation.")).toEqual({
      showAssistantMeta: true,
      copy: true,
    });
    // A turn answers, then the agent continues in a new run with more work.
    const continued = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        assistant("answer-a", 3, runA, "Here is my recommendation."),
        command("more", 10, runB, "git diff"),
        assistant("answer-b", 20, runB, "Fixed it too."),
      ],
      { latest: { runId: runB, start: 10, end: 20 } },
    );
    expect(shape(continued)).toEqual([
      "user: ask",
      "line: Worked for 3.0s",
      "answer: Here is my recommendation.",
      "line: Worked for 10s",
      "answer: Fixed it too.",
    ]);
    expect(bubbleMeta(continued, "Here is my recommendation.")).toEqual({
      showAssistantMeta: true,
      copy: true,
    });
  });

  it("shows a finished compaction as a centered event, and a running one on the live line", () => {
    const finished = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        compaction("compact", 2, runA),
        command("cat", 3, runA),
        assistant("answer", 5, runA, "Done."),
      ],
      { latest: { runId: runA, start: 0, end: 5 } },
    );
    expect(shape(finished)).toEqual([
      "user: ask",
      "line: Worked for 5.0s",
      "context-compaction: compact",
      "answer: Done.",
    ]);

    const live = rowsFor(
      [user("ask", 0, runA), command("ls", 1, runA), compaction("compact", 2, runA, true)],
      { working: runA },
    );
    expect(shape(live)).toEqual(["user: ask", "live: Thinking", "typing"]);
    expect(live.find((row) => row.kind === "chat-work")).toMatchObject({ compacting: true });
    expect(live.find((row) => row.kind === "chat-typing")).toMatchObject({ compacting: true });
  });

  it("shows T3 Code's own /compact as the compaction row alone, titled with why it ran", () => {
    const compactPrompt: OrchestrationV2TurnItem = {
      ...user("compact-prompt", 6, runB),
      text: "/compact",
      createdBy: "agent",
      creationSource: "server",
      idleCompaction: "onReturn",
    } as OrchestrationV2TurnItem;
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        assistant("answer", 5, runA, "Done."),
        compactPrompt,
        compaction("compact", 7, runB),
      ],
      { latest: { runId: runB, start: 6, end: 8 } },
    );
    expect(shape(rows)).not.toContain("user: compact-prompt");
    expect(rows.find((row) => row.kind === "context-compaction")).toMatchObject({
      label: "Context compacted after being idle",
    });
  });

  it("shows your answer to the agent's question as a reply that closes the line", () => {
    const rows = rowsFor(
      [
        user("ask", 0, runA),
        command("ls", 1, runA),
        question("pick", 2, runA),
        command("cat", 4, runA, "cat bin.ts"),
        assistant("answer", 6, runA, "Read it."),
      ],
      { latest: { runId: runA, start: 0, end: 6 } },
    );
    expect(shape(rows)).toEqual([
      "user: ask",
      "line: Worked for 1.0s",
      "reply: pick",
      "line: Worked for 4.0s",
      "answer: Read it.",
    ]);
  });

  it("keeps a line's id when its run settles, so an opened line stays open", () => {
    const items = [user("ask", 0, runA), command("ls", 1, runA)];
    const liveId = rowsFor(items, { working: runA }).find((row) => row.kind === "chat-work")?.id;
    const settledId = rowsFor([...items, assistant("answer", 3, runA)], {
      latest: { runId: runA, start: 0, end: 3 },
    }).find((row) => row.kind === "chat-work")?.id;
    expect(liveId).toBeDefined();
    expect(settledId).toBe(liveId);
  });

  it("maps each step to its line for find", () => {
    const timelineEntries = deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems: [user("ask", 0, runA), command("ls", 1, runA)].map(projected),
      optimisticMessages: [],
    });
    const lineIds = chatWorkLineIdsByEntryId({
      timelineEntries,
      latestRun: null,
      isWorking: false,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(lineIds.get("ls")).toMatch(/^chat-work:/);
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

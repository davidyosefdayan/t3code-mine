import {
  MessageId,
  OrchestrationV2TurnItem,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  latestAssistantMessagePreview,
  liveActivityForShell,
  SHELL_MESSAGE_PREVIEW_MAX_CHARS,
  truncateForShell,
} from "./ShellLiveSummary.ts";

const threadId = ThreadId.make("thread-shell-live");
const runId = RunId.make("run-shell-live");
const at = (seconds: number) => DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, 0, seconds));
const isTurnItem = Schema.is(OrchestrationV2TurnItem);

const base = (id: string, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  title: null,
  startedAt: at(ordinal),
  completedAt: null,
  updatedAt: at(ordinal),
});

const assistant = (
  id: string,
  ordinal: number,
  text: string,
  streaming = false,
): OrchestrationV2TurnItem => ({
  ...base(id, ordinal),
  type: "assistant_message",
  status: streaming ? "running" : "completed",
  messageId: MessageId.make(`message-${id}`),
  text,
  streaming,
});

const command = (
  id: string,
  ordinal: number,
  status: OrchestrationV2TurnItem["status"],
  output?: string,
): OrchestrationV2TurnItem => ({
  ...base(id, ordinal),
  type: "command_execution",
  status,
  input: "vp test run",
  ...(output === undefined ? {} : { output, exitCode: 0 }),
});

const unsettled = { archivedAt: null, settledAt: null, settledOverride: null };

const visible = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  visibility: "local" | "inherited" = "local",
): OrchestrationV2ThreadProjection["visibleTurnItems"] =>
  items.map((item, position) => ({
    position,
    visibility,
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  }));

describe("latestAssistantMessagePreview", () => {
  it("returns the newest finished reply, skipping streaming ones", () => {
    const preview = latestAssistantMessagePreview({
      thread: unsettled,
      visibleTurnItems: visible([
        assistant("a", 1, "first"),
        assistant("b", 2, "  second\n\nreply  "),
        assistant("c", 3, "still typ", true),
      ]),
    });
    expect(preview?.id).toBe(MessageId.make("message-b"));
    expect(preview?.role).toBe("assistant");
    expect(preview?.text).toBe("second reply");
  });

  it("is null for settled, archived, or inherited-only threads", () => {
    const items = visible([assistant("a", 1, "done")]);
    expect(
      latestAssistantMessagePreview({
        thread: { ...unsettled, settledAt: at(9) },
        visibleTurnItems: items,
      }),
    ).toBeNull();
    expect(
      latestAssistantMessagePreview({
        thread: { ...unsettled, settledOverride: "settled" },
        visibleTurnItems: items,
      }),
    ).toBeNull();
    expect(
      latestAssistantMessagePreview({
        thread: { ...unsettled, archivedAt: at(9) },
        visibleTurnItems: items,
      }),
    ).toBeNull();
    expect(
      latestAssistantMessagePreview({
        thread: unsettled,
        visibleTurnItems: visible([assistant("a", 1, "parent")], "inherited"),
      }),
    ).toBeNull();
  });

  it("cuts long replies with an ellipsis", () => {
    const preview = latestAssistantMessagePreview({
      thread: unsettled,
      visibleTurnItems: visible([assistant("a", 1, "x".repeat(500))]),
    });
    expect(Array.from(preview?.text ?? "")).toHaveLength(SHELL_MESSAGE_PREVIEW_MAX_CHARS);
    expect(preview?.text.endsWith("…")).toBe(true);
    expect(truncateForShell("😀😀😀", 2)).toBe("😀…");
    expect(truncateForShell("short", 10)).toBe("short");
  });
});

describe("liveActivityForShell", () => {
  const runs = [{ id: runId, requestedAt: at(0) }];

  it("is null without a live run or a running step", () => {
    expect(liveActivityForShell([command("a", 1, "running")], [])).toBeNull();
    expect(liveActivityForShell([command("a", 1, "completed")], runs)).toBeNull();
    expect(
      liveActivityForShell([{ ...command("a", 1, "running"), runId: RunId.make("other") }], runs),
    ).toBeNull();
  });

  it("picks the newest running step and drops its output", () => {
    const step = liveActivityForShell(
      [
        command("a", 1, "running"),
        command("b", 2, "running", "lots of output"),
        command("c", 3, "completed"),
      ],
      runs,
    );
    expect(step?.id).toBe(TurnItemId.make("b"));
    expect(step).not.toHaveProperty("output");
    expect(step).not.toHaveProperty("exitCode");
    expect(isTurnItem(step)).toBe(true);
  });

  it("is unchanged when only output or updatedAt changes", () => {
    const first = liveActivityForShell([command("a", 1, "running", "one")], runs);
    const later = liveActivityForShell(
      [{ ...command("a", 1, "running", "one two three"), updatedAt: at(40) }],
      runs,
    );
    expect(Schema.toEquivalence(OrchestrationV2TurnItem)(first!, later!)).toBe(true);
  });

  it("keeps a short, shallow copy of dynamic tool input", () => {
    const step = liveActivityForShell(
      [
        {
          ...base("tool", 1),
          type: "dynamic_tool",
          status: "running",
          title: "t".repeat(300),
          toolName: "Read",
          input: {
            file_path: "src/foo.ts",
            content: "y".repeat(1000),
            limit: 20,
            nested: { deep: true },
            ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "v"])),
          },
          output: { text: "z".repeat(1000) },
        },
      ],
      runs,
    );
    expect(step?.type).toBe("dynamic_tool");
    if (step?.type !== "dynamic_tool") return;
    const input = step.input as Record<string, unknown>;
    expect(input["file_path"]).toBe("src/foo.ts");
    expect(Array.from(input["content"] as string)).toHaveLength(200);
    expect(input["limit"]).toBe(20);
    expect(input).not.toHaveProperty("nested");
    expect(Object.keys(input)).toHaveLength(8);
    expect(Array.from(step.title ?? "")).toHaveLength(200);
    expect(step).not.toHaveProperty("output");
    expect(isTurnItem(step)).toBe(true);
  });
});

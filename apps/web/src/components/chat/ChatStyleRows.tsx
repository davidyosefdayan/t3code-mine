// Personal build: the chat-style timeline's own rows (see chatTimelineRows.ts).
// Presentational only; MessagesTimeline reads its row context and passes it in.
import {
  getQuestionAnswerPreview,
  getQuestionTextPreview,
} from "@t3tools/client-runtime/work-log/user-input";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

/**
 * Your messages are a theme-color bubble. The overrides make the text, chips,
 * borders, and controls (such as "Show full message") inside it read light.
 */
export const USER_BUBBLE_CLASS_NAME =
  "rounded-2xl rounded-br-md bg-message px-4 py-2.5 text-message-foreground [--contrast-message-foreground:var(--message-action-foreground)] [--message-surface:var(--message-action)] [--contrast-foreground:var(--message-action-foreground)] [--foreground:var(--message-action-foreground)] [--contrast-border:color-mix(in_srgb,var(--message-action-foreground)_35%,transparent)] [--contrast-muted-foreground:color-mix(in_srgb,var(--message-action-foreground)_80%,transparent)] [--accent:color-mix(in_srgb,var(--message-action-foreground)_14%,transparent)] [--info-foreground:var(--message-action-foreground)] [&_[data-slot=context-chip]]:[--context-chip-accent:var(--message-action-foreground)] [&_[data-slot=context-chip]]:[--context-chip-foreground:var(--message-action-foreground)]";

/** The agent's answer, and what it tells you along the way: a gray bubble. */
export const AGENT_BUBBLE_CLASS_NAME =
  "w-fit max-w-full rounded-2xl rounded-bl-md bg-agent-bubble px-4 py-2.5";

/** Steps and notes inside an opened work line hang off one continuous rail. */
export function chatRowOnRail(row: MessagesTimelineRow): boolean {
  return (
    (row.kind === "work" && row.chat === "step") || (row.kind === "message" && row.chat === "note")
  );
}

// Rows sit on fractional pixels, so the bar reaches a pixel past each edge to
// overlap its neighbours instead of leaving hairline gaps.
export const CHAT_RAIL_CLASS_NAME =
  "relative ms-2 ps-3.5 before:absolute before:-top-px before:-bottom-px before:start-0 before:w-0.5 before:bg-border";

/** Typing dots. The steps() timing keeps them to a few repaints a cycle; they pause off screen. */
function TypingDots() {
  return (
    <span ref={observeVisibleAnimation} className="flex shrink-0 items-center gap-1" aria-hidden>
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" />
    </span>
  );
}

/** While the agent works, a typing bubble sits where its answer will appear. */
export function ChatTypingTimelineRow({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <div
      className="mt-1 flex w-fit items-center rounded-2xl rounded-bl-md bg-agent-bubble px-4 py-3"
      role="status"
      aria-label="The agent is working"
    >
      <TypingDots />
    </div>
  );
}

/**
 * A turn's work line: "Worked for …" once it settles, the current step while
 * it works. Clicking it shows or hides the work right below it.
 */
export function ChatWorkLineContent(props: {
  label: ReactNode;
  expanded: boolean;
  canExpand: boolean;
  timer?: ReactNode;
  trailing?: ReactNode;
  onToggle: () => void;
}) {
  const Icon = props.expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="flex min-w-0 items-center gap-2 py-0.5">
      <button
        type="button"
        aria-expanded={props.canExpand ? props.expanded : undefined}
        disabled={!props.canExpand}
        data-scroll-anchor-ignore
        onClick={props.onToggle}
        className="flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-md px-1.5 py-0.5 text-muted-foreground text-xs tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 disabled:cursor-default disabled:hover:text-muted-foreground"
      >
        <span className="min-w-0 truncate">{props.label}</span>
        {props.timer ? <span className="shrink-0 opacity-70">{props.timer}</span> : null}
        {props.canExpand ? <Icon className="size-3.5 shrink-0" /> : null}
      </button>
      {props.trailing}
    </div>
  );
}

/** Your answer to a question the agent asked, as a reply bubble quoting the question. */
export function ChatReplyTimelineRow({ entry }: { entry: WorkLogEntry }) {
  const answer = entry.questionAnswer;
  if (!answer) return null;
  const question = getQuestionTextPreview(answer);
  const reply = getQuestionAnswerPreview(answer);
  return (
    <div className="flex justify-end">
      <div className={cn("max-w-[80%] text-sm leading-relaxed", USER_BUBBLE_CLASS_NAME)}>
        {question ? (
          <div className="mb-1.5 border-s-2 border-current/40 ps-2.5 text-xs opacity-80">
            {question}
          </div>
        ) : null}
        <div className="whitespace-pre-wrap">{reply}</div>
      </div>
    </div>
  );
}

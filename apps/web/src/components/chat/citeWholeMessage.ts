// Personal build: cites a whole answer, for the Cite button under it. Goes
// through the same capture as selecting the answer and pressing Cite, so the
// composer gets an ordinary citation.
import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";

type Citer = {
  readonly threadRef: ScopedThreadRef;
  readonly onCite: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
};

// Keyed by the chat list's viewport, which the selection toolbar is mounted for.
const citers = new WeakMap<HTMLElement, Citer>();

export function registerMessageCiter(viewport: HTMLElement, citer: Citer) {
  citers.set(viewport, citer);
  return () => {
    if (citers.get(viewport) === citer) citers.delete(viewport);
  };
}

/** Cites answer `messageId`, found from a control inside the same chat. */
export function citeWholeMessage(
  from: Element,
  messageId: string,
): "cited" | "too-long" | "failed" {
  const viewport = from.closest<HTMLElement>("[data-assistant-citation-viewport]");
  const citer = viewport ? citers.get(viewport) : undefined;
  const source = viewport?.querySelector<HTMLElement>(
    `[data-assistant-citation-source="${CSS.escape(messageId)}"]`,
  );
  const selection = window.getSelection();
  if (!viewport || !citer || !source || !selection) return "failed";
  const range = document.createRange();
  range.selectNodeContents(source);
  selection.removeAllRanges();
  selection.addRange(range);
  const captured = captureAssistantTextSelection(viewport, selection);
  selection.removeAllRanges();
  if (!captured) return "failed";
  if (captured.selector.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return "too-long";
  const cited = citer.onCite(
    { version: 1, ...citer.threadRef, messageId: MessageId.make(messageId), ...captured.selector },
    { source: captured.source, range: captured.range, viewport },
  );
  return cited ? "cited" : "failed";
}

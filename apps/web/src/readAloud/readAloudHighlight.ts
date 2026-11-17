// Personal build: highlights the word being read, and softly its sentence, in
// the message on screen. Uses the CSS Custom Highlight API, so the message's
// DOM is never touched and React never re-renders for it.

import { spokenFormOf } from "./readAloudText";

const WORD_HIGHLIGHT = "read-aloud-word";
const SENTENCE_HIGHLIGHT = "read-aloud-sentence";
// Above this many word pairs, alignment falls back to a forward search rather
// than spend memory on a huge table (a few thousand words each way).
const MAX_ALIGNMENT_CELLS = 4_000_000;
const LOOKAHEAD_WORDS = 12;

/** Lowercase letters and digits only, so "**Fix:**" on screen matches "Fix:" spoken. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * For each spoken word, the index of the same word on screen, or null.
 *
 * Speech and screen differ: code is skipped, links become "a link", and
 * symbols are spoken as words ("→" is "to"). This keeps the largest set of
 * matches that stays in reading order, so a spoken word that isn't on screen
 * can't latch onto the same word further down and pull everything after it
 * out of sync.
 */
export function alignWords(
  spoken: readonly string[],
  screen: readonly string[],
): (number | null)[] {
  const a = spoken.map(normalizeWord);
  const b = screen.map(normalizeWord);
  const rows = a.length + 1;
  const cols = b.length + 1;
  if (rows * cols > MAX_ALIGNMENT_CELLS) return alignForward(a, b);

  // best[i][j]: most matches between spoken words i.. and screen words j..
  const best = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      best[i * cols + j] =
        a[i] !== "" && a[i] === b[j]
          ? best[(i + 1) * cols + j + 1]! + 1
          : Math.max(best[(i + 1) * cols + j]!, best[i * cols + j + 1]!);
    }
  }
  const matches: (number | null)[] = Array.from({ length: a.length }, () => null);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== "" && a[i] === b[j]) {
      matches[i] = j;
      i += 1;
      j += 1;
    } else if (best[(i + 1) * cols + j]! >= best[i * cols + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

/**
 * For each spoken word, the index of the screen word it is said for. Screen
 * words are compared by how they're spoken, so "command" lands on "⌘Q" and
 * "to" on "→" instead of leaving the highlight blank while they're said.
 */
export function alignToScreen(
  spoken: readonly string[],
  screen: readonly string[],
): (number | null)[] {
  const forms = screen.flatMap((word, index) =>
    spokenFormOf(word).map((form) => ({ form, index })),
  );
  return alignWords(
    spoken,
    forms.map((entry) => entry.form),
  ).map((match) => (match === null ? null : forms[match]!.index));
}

/** Cheaper matching for very long messages: walk forward, looking a few words ahead. */
function alignForward(spoken: readonly string[], screen: readonly string[]): (number | null)[] {
  let next = 0;
  return spoken.map((target) => {
    if (target === "") return null;
    const limit = Math.min(screen.length, next + LOOKAHEAD_WORDS);
    for (let index = next; index < limit; index += 1) {
      if (screen[index] === target) {
        next = index + 1;
        return index;
      }
    }
    return null;
  });
}

type ScreenWord = { readonly node: Text; readonly start: number; readonly end: number };

function screenWords(root: Element): ScreenWord[] {
  const words: ScreenWord[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    // Code blocks are skipped when reading, so they're skipped here too.
    acceptNode: (node) =>
      node.parentElement?.closest("pre, .chat-markdown-codeblock")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    for (const match of text.data.matchAll(/\S+/g)) {
      words.push({ node: text, start: match.index, end: match.index + match[0].length });
    }
  }
  return words;
}

function messageRoot(messageId: string): Element | null {
  return document.querySelector(
    `[data-message-id="${CSS.escape(messageId)}"][data-message-role="assistant"] .chat-markdown`,
  );
}

/**
 * Tracks one message being read. Screen positions are found again whenever the
 * message re-renders or scrolls back into view, so highlighting survives both.
 */
export class MessageHighlighter {
  private readonly spoken: readonly string[];
  private root: Element | null = null;
  private words: ScreenWord[] = [];
  private matches: (number | null)[] = [];

  constructor(
    private readonly messageId: string,
    /** Every word that will be spoken, across all sentences, in order. */
    spokenWords: readonly string[],
  ) {
    this.spoken = spokenWords;
  }

  /** Highlights spoken word `word`, within the sentence spanning `sentence` (inclusive). */
  show(word: number, sentence: { readonly first: number; readonly last: number }) {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    if (!this.sync()) return this.clear();
    const range = (from: number, to: number) => {
      const start = this.firstMatch(from, to, 1);
      const end = this.firstMatch(to, from, -1);
      if (start === null || end === null) return null;
      const r = new Range();
      r.setStart(this.words[start]!.node, this.words[start]!.start);
      r.setEnd(this.words[end]!.node, this.words[end]!.end);
      return r;
    };
    const sentenceRange = range(sentence.first, sentence.last);
    // A word with nothing on screen (a URL spoken as "a link") keeps the
    // sentence's previous word lit rather than blinking off.
    let lit = word;
    while (lit > sentence.first && this.matches[lit] == null) lit -= 1;
    const wordRange = this.matches[lit] == null ? null : range(lit, lit);
    CSS.highlights.set(
      SENTENCE_HIGHLIGHT,
      new Highlight(...(sentenceRange ? [sentenceRange] : [])),
    );
    const wordHighlight = new Highlight(...(wordRange ? [wordRange] : []));
    wordHighlight.priority = 1; // Drawn over the sentence's softer highlight.
    CSS.highlights.set(WORD_HIGHLIGHT, wordHighlight);
  }

  /** Whether `node` is inside this message on screen. */
  contains(node: Node): boolean {
    return this.sync() && this.root!.contains(node);
  }

  /**
   * The first spoken word at or after a point in the message (a click, or
   * where a selection starts), or null when nothing is spoken from there on.
   */
  spokenWordAt(node: Node, offset: number): number | null {
    if (!this.sync() || !this.root!.contains(node)) return null;
    const wordEnd = new Range();
    const screenIndex = this.words.findIndex((word) => {
      wordEnd.setStart(word.node, word.end);
      return wordEnd.comparePoint(node, offset) <= 0;
    });
    if (screenIndex === -1) return null;
    const spoken = this.matches.findIndex((match) => match != null && match >= screenIndex);
    return spoken === -1 ? null : spoken;
  }

  /**
   * Where spoken word `word` (or the closest one before it with a place on
   * screen) is drawn, and the chat list scrolling it. Null when the message
   * isn't on screen.
   */
  locate(word: number): { readonly rect: DOMRect; readonly scroller: Element | null } | null {
    if (!this.sync()) return null;
    let lit = Math.min(word, this.matches.length - 1);
    while (lit > 0 && this.matches[lit] == null) lit -= 1;
    const match = this.matches[lit] ?? this.firstMatch(0, this.matches.length - 1, 1);
    if (match === null) return null;
    const target = this.words[match]!;
    const range = new Range();
    range.setStart(target.node, target.start);
    range.setEnd(target.node, target.end);
    return {
      rect: range.getBoundingClientRect(),
      scroller: this.root!.closest(".messages-timeline-scroll"),
    };
  }

  clear() {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    CSS.highlights.delete(WORD_HIGHLIGHT);
    CSS.highlights.delete(SENTENCE_HIGHLIGHT);
  }

  /** Re-reads the message's words when its DOM was replaced. False if it's not on screen. */
  private sync(): boolean {
    const current = this.root?.isConnected && this.words[0]?.node.isConnected ? this.root : null;
    if (current) return true;
    this.root = messageRoot(this.messageId);
    if (!this.root) return false;
    this.words = screenWords(this.root);
    this.matches = alignToScreen(
      this.spoken,
      this.words.map((word) => word.node.data.slice(word.start, word.end)),
    );
    return true;
  }

  private firstMatch(from: number, to: number, step: 1 | -1): number | null {
    for (let index = from; step > 0 ? index <= to : index >= to; index += step) {
      const match = this.matches[index];
      if (match != null) return match;
    }
    return null;
  }
}

// Personal build: turns an agent's markdown answer into sentences Kokoro can say.
import { resolveInlineCodeFileLinkMeta } from "~/markdown-links";

// Kokoro reads at most ~500 phonemes per call; sentences longer than this get
// split at clause breaks, then at word breaks.
const MAX_CHUNK_CHARS = 280;

const ENDS_WITH_PUNCTUATION = /[.!?:;,]["')\]]?$/;

// Symbols the voice skips or reads oddly. Key glyphs get a trailing space so
// "⌘Q" is read as "command Q".
const SPOKEN_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/⌘\s*/g, "command "],
  [/⌥\s*/g, "option "],
  [/⇧\s*/g, "shift "],
  [/⌃\s*/g, "control "],
  [/\s*(→|->|⟶)\s*/g, " to "],
  [/\s*(←|<-)\s*/g, " from "],
  [/\s+&\s+/g, " and "],
  [/≈\s*/g, "about "],
  [/\s*≥\s*/g, " at least "],
  [/\s*≤\s*/g, " at most "],
];

// A word that starts with a dot is a dotfile name, said with its dots:
// ".env" is "dot env", ".dev.vars" is "dot dev dot vars".
const DOTFILE = /(^|[\s(])\.([a-z][\w-]*(?:\.[a-z][\w-]*)*)/gi;

function speakSymbols(text: string): string {
  let spoken = text.replace(
    DOTFILE,
    (_, before: string, name: string) => `${before}dot ${name.split(".").join(" dot ")}`,
  );
  for (const [symbol, words] of SPOKEN_SYMBOLS) spoken = spoken.replace(symbol, words);
  return spoken;
}

/**
 * The words a piece of on-screen text is spoken as, for matching speech to the
 * screen: "⌘Q" is ["command", "Q"], "→" is ["to"], and a file chip's "L42" is
 * ["line", "42"].
 */
export function spokenFormOf(screenText: string): string[] {
  return speakSymbols(screenText.replace(/^L(\d+)(?::C\d+)?$/, "line $1"))
    .split(/\s+/)
    .filter((word) => word !== "");
}

/**
 * Inline code that the chat shows as a file or folder chip is read as the
 * chip's name: "`/tmp/kokoro-trim/`" is "kokoro-trim", and "`src/app.ts:42`" is
 * "app.ts, line 42". The project folder only
 * changes the chip's link, not its name, so any folder works here.
 */
function speakInlineCode(code: string): string {
  const file = resolveInlineCodeFileLinkMeta(code, "/workspace");
  if (!file) return code;
  return file.line === undefined ? file.basename : `${file.basename}, line ${file.line}`;
}

/** Strips markdown syntax a listener shouldn't hear. Code blocks are dropped. */
export function speakableText(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, "\n")
    .replace(/<[^>\n]+>/g, "")
    .split("\n");

  const spoken: string[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(line)) continue;
    if (line === "" || /^([-*_]\s*){3,}$/.test(line)) {
      spoken.push("");
      continue;
    }
    // Headings, list items, and table rows get their own sentence, so they get a pause.
    const standalone = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/.test(line.replace(/^(>\s*)+/, ""));
    line = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(>\s*)+/, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^(\d+)[.)]\s+/, "$1, ")
      .replace(/^\|(.*)\|$/, "$1")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "a link")
      .replace(/`([^`]+)`/g, (_, code: string) => speakInlineCode(code))
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1");
    line = speakSymbols(line).trim();
    if (line !== "")
      spoken.push(standalone && !ENDS_WITH_PUNCTUATION.test(line) ? `${line}.` : line);
  }

  return spoken
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter((paragraph) => paragraph !== "")
    .join("\n\n");
}

/** Splits speakable text into sentence-sized pieces, so playback can start after the first. */
export function speakableChunks(markdown: string): string[] {
  const text = speakableText(markdown);
  return text
    .split(/(?<=[.!?]["')\]]?)\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence))
    .flatMap((sentence) => splitLongSentence(sentence));
}

function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];
  const pieces: string[] = [];
  let current = "";
  for (const clause of sentence.split(/(?<=[,;:])\s+|\s+(?=—)/)) {
    for (const word of clause.length > MAX_CHUNK_CHARS ? clause.split(/\s+/) : [clause]) {
      if (current !== "" && current.length + word.length + 1 > MAX_CHUNK_CHARS) {
        pieces.push(current);
        current = word;
      } else {
        current = current === "" ? word : `${current} ${word}`;
      }
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

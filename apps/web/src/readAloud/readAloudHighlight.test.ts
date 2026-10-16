import { describe, expect, it } from "vite-plus/test";

import { alignToScreen, alignWords } from "./readAloudHighlight";
import { speakableText } from "./readAloudText";

const words = (text: string) => text.split(/\s+/).filter((word) => word !== "");

describe("alignWords", () => {
  it("matches spoken words to screen words despite markdown punctuation", () => {
    expect(alignWords(["Fix:", "it", "now."], ["**Fix:**", "it", "now."])).toEqual([0, 1, 2]);
  });

  it("skips screen words that are never spoken and spoken words not on screen", () => {
    // The link's URL is spoken as "a link"; the code span on screen is not spoken.
    const spoken = ["See", "a", "link", "then", "run", "it."];
    const screen = ["See", "https://x.dev", "then", "run", "`ls`", "it."];
    expect(alignWords(spoken, screen)).toEqual([0, null, null, 2, 3, 5]);
  });

  it("keeps repeated words in reading order", () => {
    expect(alignWords(["the", "cat", "the", "dog"], ["the", "cat", "the", "dog"])).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("stays in sync when speech says words the screen shows as symbols", () => {
    // "→" is spoken as "to"; a real "to" later must not pull the highlight ahead.
    const markdown =
      "Open **Settings → Environments → Production**. Then go to the tab and press ⌘Q.";
    const screen = words(
      "Open Settings → Environments → Production. Then go to the tab and press ⌘Q.",
    );
    const spoken = words(speakableText(markdown));
    const matches = alignWords(spoken, screen);
    const matched = spoken.flatMap((word, index) => {
      const at = matches[index];
      return at == null ? [] : [[word, screen[at]]];
    });
    expect(matched).toEqual([
      ["Open", "Open"],
      ["Settings", "Settings"],
      ["Environments", "Environments"],
      ["Production.", "Production."],
      ["Then", "Then"],
      ["go", "go"],
      ["to", "to"],
      ["the", "the"],
      ["tab", "tab"],
      ["and", "and"],
      ["press", "press"],
      ["Q.", "⌘Q."],
    ]);
  });
});

describe("alignToScreen", () => {
  it("highlights the symbol while its spoken words are said", () => {
    const markdown = "Open **Settings → Production**, then press ⌘Q to quit.";
    const screen = words("Open Settings → Production, then press ⌘Q to quit.");
    const spoken = words(speakableText(markdown));
    expect(spoken).toEqual(words("Open Settings to Production, then press command Q to quit."));
    const pairs = alignToScreen(spoken, screen).map((at, index) => [
      spoken[index],
      at === null ? null : screen[at],
    ]);
    expect(pairs).toEqual([
      ["Open", "Open"],
      ["Settings", "Settings"],
      ["to", "→"],
      ["Production,", "Production,"],
      ["then", "then"],
      ["press", "press"],
      ["command", "⌘Q"],
      ["Q", "⌘Q"],
      ["to", "to"],
      ["quit.", "quit."],
    ]);
  });

  it("highlights a dotfile name while its dots are said", () => {
    const spoken = words(speakableText("Edit `.dev.vars` now."));
    const screen = ["Edit", ".dev.vars", "now."];
    const pairs = alignToScreen(spoken, screen).map((at) => (at === null ? null : screen[at]));
    expect(pairs).toEqual(["Edit", ".dev.vars", ".dev.vars", ".dev.vars", ".dev.vars", "now."]);
  });

  it("matches a file chip's line number", () => {
    const spoken = words(speakableText("Fixed in `src/readAloud/readAloudPlayer.ts:42` today."));
    const screen = ["Fixed", "in", "readAloudPlayer.ts", "·", "L42", "today."];
    const pairs = alignToScreen(spoken, screen).map((at) => (at === null ? null : screen[at]));
    expect(pairs).toEqual(["Fixed", "in", "readAloudPlayer.ts", "L42", "L42", "today."]);
  });
});

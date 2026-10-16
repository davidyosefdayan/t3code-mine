import { describe, expect, it } from "vite-plus/test";

import { speakableChunks, speakableText } from "./readAloudText";

describe("speakableText", () => {
  it("drops code blocks and markdown syntax", () => {
    const markdown = [
      "## Summary",
      "",
      "**#827 migration check:** you were right. See [the PR](https://github.com/x/y/pull/1).",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "Run `vp test` and check https://example.com/page.",
    ].join("\n");

    expect(speakableText(markdown)).toBe(
      [
        "Summary.",
        "#827 migration check: you were right. See the PR.",
        "Run vp test and check a link",
      ].join("\n\n"),
    );
  });

  it("gives list items their own sentence but keeps wrapped prose together", () => {
    const markdown = [
      "I need your call on",
      "two things:",
      "",
      "1. New items go to Not invoiced",
      "2. Publishing on activation",
      "- *Frontend* asks first",
    ].join("\n");

    expect(speakableText(markdown)).toBe(
      [
        "I need your call on two things:",
        "1, New items go to Not invoiced. 2, Publishing on activation. Frontend asks first.",
      ].join("\n\n"),
    );
  });

  it("reads table rows and skips separator rows", () => {
    const markdown = ["| Model | Score |", "| --- | ---: |", "| Kokoro | 1064 |"].join("\n");
    expect(speakableText(markdown)).toBe("Model, Score. Kokoro, 1064.");
  });

  it("keeps snake_case identifiers intact", () => {
    expect(speakableText("Set read_aloud_voice to am_michael.")).toBe(
      "Set read_aloud_voice to am_michael.",
    );
  });
});

describe("speakableText symbols and paths", () => {
  it("names keyboard symbols and arrows", () => {
    expect(speakableText("Quit with ⌘Q, then open **Settings → Environments → Production**.")).toBe(
      "Quit with command Q, then open Settings to Environments to Production.",
    );
  });

  it("reads file and folder chips by the name the chip shows", () => {
    expect(
      speakableText(
        "See `/tmp/kokoro-trim/`, `apps/web/src/readAloud/readAloudPlayer.ts:42` and `vp test`.",
      ),
    ).toBe("See kokoro-trim, readAloudPlayer.ts, line 42 and vp test.");
  });

  it("says the dots in dotfile names", () => {
    expect(speakableText("Update `.env` and `.dev.vars`. Then check .gitignore.")).toBe(
      "Update dot env and dot dev dot vars. Then check dot gitignore.",
    );
  });

  it("leaves paths outside code alone", () => {
    expect(speakableText("Use and/or, or 1/2 cup.")).toBe("Use and/or, or 1/2 cup.");
  });
});

describe("speakableChunks", () => {
  it("splits sentences without breaking decimals", () => {
    expect(speakableChunks("Speed is 1.5 now. Ready? Yes!\n\nNext paragraph")).toEqual([
      "Speed is 1.5 now.",
      "Ready?",
      "Yes!",
      "Next paragraph",
    ]);
  });

  it("splits long sentences under the model's length limit", () => {
    const sentence = `${Array.from({ length: 40 }, (_, i) => `clause number ${i}`).join(", ")}.`;
    const chunks = speakableChunks(sentence);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 280)).toBe(true);
    expect(chunks.join(" ")).toBe(sentence);
  });

  it("returns nothing for a reply that is only code", () => {
    expect(speakableChunks("```sh\nls -la\n```")).toEqual([]);
  });
});

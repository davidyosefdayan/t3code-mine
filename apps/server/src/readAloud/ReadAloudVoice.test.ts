import { describe, expect, it } from "vite-plus/test";

import { readAloudVoiceFromAsset } from "./ReadAloudVoice.ts";

describe("readAloudVoiceFromAsset", () => {
  it.each([
    [
      { name: "aaron", language: "en-US", assetKey: "en-US:fmvoice:male:aaron:premium:0" },
      {
        id: "expressive:aaron",
        name: "Aaron",
        gender: "male",
        language: "en-US",
        kind: "expressive",
      },
    ],
    [
      { name: "en-US-F", language: "en-US", assetKey: "en-US:fmvoice:male:en-US-F:premium:0" },
      {
        id: "expressive:en-US-F",
        name: "Voice F",
        gender: "male",
        language: "en-US",
        kind: "expressive",
      },
    ],
    [
      { name: "Nora", language: "en-US", assetKey: "en-US:natural:female:Nora:premium:5068" },
      { id: "standard:Nora", name: "Nora", gender: "female", language: "en-US", kind: "standard" },
    ],
  ])("reads %o", (asset, voice) => {
    expect(readAloudVoiceFromAsset(asset)).toEqual(voice);
  });

  it("skips voice families it doesn't know", () => {
    expect(
      readAloudVoiceFromAsset({
        name: "Fred",
        language: "en-US",
        assetKey: "en-US:compact:male:Fred",
      }),
    ).toBeNull();
  });
});

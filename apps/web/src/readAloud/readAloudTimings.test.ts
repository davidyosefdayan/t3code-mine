import { describe, expect, it } from "vite-plus/test";

import { wordTimings } from "./readAloudTimings";

const PAD = 0;
const SPACE = 16;

describe("wordTimings", () => {
  it("times each word from its phoneme durations, after leading silence", () => {
    // $ h i _ y o u $  (frames: 4 1 1 1 2 2 1)
    const timings = wordTimings({
      text: "Hi you.",
      tokenIds: [PAD, 1, 2, SPACE, 3, 4, PAD],
      durations: [4, 1, 1, 1, 2, 2, 1],
      spaceTokenId: SPACE,
      padTokenId: PAD,
      secondsPerFrame: 0.025,
    });
    const rounded = timings.map(({ start, end }) => [+start.toFixed(3), +end.toFixed(3)]);
    expect(rounded).toEqual([
      [0.1, 0.15],
      [0.175, 0.275],
    ]);
  });

  it("spreads a written word that is spoken as several words", () => {
    // "612 passed" is spoken as "six hundred twelve passed": four spoken words.
    const timings = wordTimings({
      text: "612 passed",
      tokenIds: [PAD, 1, SPACE, 2, SPACE, 3, SPACE, 4, PAD],
      durations: [0, 10, 0, 10, 0, 10, 0, 10, 0],
      spaceTokenId: SPACE,
      padTokenId: PAD,
      secondsPerFrame: 1,
    });
    expect(timings).toHaveLength(2);
    expect(timings[0]!.start).toBe(0);
    expect(timings[1]!.end).toBe(40);
    expect(timings[0]!.end).toBeLessThanOrEqual(timings[1]!.start);
  });

  it("returns zero times when the model reported no words", () => {
    expect(
      wordTimings({
        text: "Hello",
        tokenIds: [PAD, PAD],
        durations: [3, 3],
        spaceTokenId: SPACE,
        padTokenId: PAD,
        secondsPerFrame: 1,
      }),
    ).toEqual([{ start: 0, end: 0 }]);
  });
});

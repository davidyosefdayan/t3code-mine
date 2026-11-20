import { converter, parse } from "culori/fn";
import { describe, expect, it } from "vite-plus/test";

import { counterpartSeed } from "./mineThemes";

const lightness = (hex: string) => converter("oklch")(parse(hex)!)?.l ?? Number.NaN;

describe("counterpartSeed", () => {
  it("carries a background to the other appearance only when one is given", () => {
    const seed = { rail: "#1d3557", accent: "#e63946" };
    expect(counterpartSeed(seed, "light").canvas).toBeUndefined();
    expect(
      lightness(counterpartSeed({ ...seed, canvas: "#1a1b26" }, "light").canvas!),
    ).toBeGreaterThan(0.97);
    expect(lightness(counterpartSeed({ ...seed, canvas: "#f4efe6" }, "dark").canvas!)).toBeLessThan(
      0.21,
    );
  });
});

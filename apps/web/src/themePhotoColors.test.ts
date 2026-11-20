import { converter, parse } from "culori/fn";
import { describe, expect, it } from "vite-plus/test";

import { photoThemeSeed } from "./themePhotoColors";

const toOklch = converter("oklch");
const hueOf = (hex: string) => toOklch(parse(hex)!)?.h ?? Number.NaN;

function pixels(...runs: ReadonlyArray<readonly [hex: string, count: number]>) {
  const data: number[] = [];
  for (const [hex, count] of runs) {
    const value = Number.parseInt(hex.slice(1), 16);
    for (let index = 0; index < count; index++) {
      data.push((value >> 16) & 255, (value >> 8) & 255, value & 255, 255);
    }
  }
  return new Uint8ClampedArray(data);
}

describe("photoThemeSeed", () => {
  it("tints the rail with the photo's main hue and takes the accent from its most vivid color", () => {
    const seed = photoThemeSeed(pixels(["#2a4f7a", 75], ["#e2701c", 25]));
    expect(Math.abs(hueOf(seed!.rail) - hueOf("#2a4f7a"))).toBeLessThan(10);
    expect(Math.abs(hueOf(seed!.accent!) - hueOf("#e2701c"))).toBeLessThan(10);
  });

  it("keeps a gray photo neutral, accent included", () => {
    const seed = photoThemeSeed(pixels(["#555555", 60], ["#bbbbbb", 40]));
    expect(toOklch(parse(seed!.rail)!)?.c ?? 0).toBeLessThan(0.01);
    expect(toOklch(parse(seed!.accent)!)?.c ?? 0).toBeLessThan(0.01);
  });

  it("gives a muted photo an accent in its own cast", () => {
    // Snow: pale blue-gray with no strong color.
    const seed = photoThemeSeed(pixels(["#c9d3db", 60], ["#a9b5bf", 40]));
    const accent = toOklch(parse(seed!.accent)!);
    expect(Math.abs((accent?.h ?? 0) - hueOf("#a9b5bf"))).toBeLessThan(15);
    expect(accent?.c ?? 0).toBeLessThanOrEqual(0.061);
  });

  it("ignores transparent pixels", () => {
    expect(photoThemeSeed(new Uint8ClampedArray([255, 0, 0, 0]))).toBeNull();
  });
});

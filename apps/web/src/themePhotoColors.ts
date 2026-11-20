import "culori/css";
import { clampRgb, converter, formatHex } from "culori/fn";

// Personal build: a photo theme's rail and accent, read from its photo the way the
// built-in photo themes' colors were picked: the rail in the photo's main tone, the
// accent in its most vivid color.
const toOklab = converter("oklab");
const toOklch = converter("oklch");
const toRgb = converter("rgb");

const HUE_BINS = 12;
const MIN_CHROMA = 0.04;
/** A hue must cover this share of the photo to count, so a few stray pixels never win. */
const MIN_HUE_SHARE = 0.03;
/** Below this share the photo's main hue is too weak to tint the rail; the overall tone is used. */
const MIN_RAIL_SHARE = 0.2;
const MIN_ACCENT_CHROMA = 0.1;
/** A muted photo's accent: its own cast, strengthened only this far, so snow reads slate, not blue. */
const MUTED_ACCENT_LIGHTNESS = 0.6;
const MAX_MUTED_ACCENT_CHROMA = 0.06;

type Lab = { l: number; a: number; b: number };

export type PhotoThemeSeed = Readonly<{ rail: string; accent: string }>;

function meanOf(samples: ReadonlyArray<Lab>): Lab {
  let l = 0;
  let a = 0;
  let b = 0;
  for (const sample of samples) {
    l += sample.l;
    a += sample.a;
    b += sample.b;
  }
  return { l: l / samples.length, a: a / samples.length, b: b / samples.length };
}

function chromaOf(sample: Lab): number {
  return Math.hypot(sample.a, sample.b);
}

function hexOf(sample: Lab): string {
  return formatHex(clampRgb(toRgb({ mode: "oklab", ...sample }))) ?? "#000000";
}

/** Reads RGBA pixels (a small downscale of the photo). Null when every pixel is transparent. */
export function photoThemeSeed(pixels: Uint8ClampedArray): PhotoThemeSeed | null {
  const all: Lab[] = [];
  const bins: Lab[][] = Array.from({ length: HUE_BINS }, () => []);
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 128) continue;
    const { l, a, b } = toOklab({
      mode: "rgb",
      r: (pixels[index] ?? 0) / 255,
      g: (pixels[index + 1] ?? 0) / 255,
      b: (pixels[index + 2] ?? 0) / 255,
    });
    const sample = { l, a, b };
    all.push(sample);
    if (chromaOf(sample) < MIN_CHROMA) continue;
    const turn = (Math.atan2(b, a) / (2 * Math.PI) + 1) % 1;
    bins[Math.floor(turn * HUE_BINS) % HUE_BINS]?.push(sample);
  }
  if (all.length === 0) return null;

  const hues = bins.filter((bin) => bin.length >= all.length * MIN_HUE_SHARE);
  const main = [...hues].sort((x, y) => y.length - x.length)[0];
  const rail = hexOf(meanOf(main && main.length >= all.length * MIN_RAIL_SHARE ? main : all));

  const vividness = (bin: ReadonlyArray<Lab>) =>
    bin.reduce((total, sample) => total + chromaOf(sample), 0) / bin.length;
  const vivid = [...hues].sort((x, y) => vividness(y) - vividness(x))[0];
  if (!vivid) {
    const { c = 0, h = 0 } = toOklch({ mode: "oklab", ...meanOf(all) });
    const accent = { l: MUTED_ACCENT_LIGHTNESS, c: Math.min(c * 3, MAX_MUTED_ACCENT_CHROMA), h };
    return { rail, accent: formatHex(clampRgb(toRgb({ mode: "oklch", ...accent }))) ?? rail };
  }
  const { l = 0, c = 0, h = 0 } = toOklch({ mode: "oklab", ...meanOf(vivid) });
  const accent = formatHex(
    clampRgb(toRgb({ mode: "oklch", l, c: Math.max(c, MIN_ACCENT_CHROMA), h })),
  );
  return { rail, accent: accent ?? rail };
}

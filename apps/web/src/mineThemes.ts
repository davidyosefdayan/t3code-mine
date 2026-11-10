import type { Color } from "culori";
import "culori/css";
import { clampRgb, converter, formatHex, parse } from "culori/fn";
import {
  T3_CODE_DARK_THEME_COLORS,
  T3_CODE_LIGHT_THEME_COLORS,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "@t3tools/shared/themePalettes";

import { COLOR_THEMES, isDarkColor, type ThemeColors as SeedColors } from "./palette";

// Personal build: the fork's themes as built-in themes of upstream's theme system.
// Each is a few hand-picked colors per mode (palette.ts); everything else is
// derived here: a neutral chat canvas, the thread list in the rail's hue, and
// soft accent tints for controls.
const MINE_THEME_COLLECTION = { id: "t3-code-mine", label: "T3 Code (Mine)" } as const;

const toOklab = converter("oklab");
const toOklch = converter("oklch");
const toRgb = converter("rgb");

function color(value: string) {
  const parsed = parse(value);
  if (!parsed) throw new Error(`Invalid theme seed color: ${value}`);
  return parsed;
}

function hex(value: Color): string {
  return formatHex(clampRgb(toRgb(value))) ?? "#000000";
}

/** `amount` of `top` over `base`, mixed in Oklab like CSS color-mix. */
function mix(top: string, amount: number, base: string): string {
  const a = toOklab(color(top));
  const b = toOklab(color(base));
  return hex({
    mode: "oklab",
    l: a.l * amount + b.l * (1 - amount),
    a: a.a * amount + b.a * (1 - amount),
    b: a.b * amount + b.b * (1 - amount),
  });
}

/** The rail's hue, darkened, at half its saturation: the dark thread list. */
function darkList(rail: string): string {
  const { c = 0, h = 0 } = toOklch(color(rail));
  return hex({ mode: "oklch", l: 0.2, c: c * 0.5, h });
}

/** The few colors a theme is made from; everything else is derived. */
type MineThemeSeed = Readonly<{
  rail: string;
  accent: string;
  /** The chat area; neutral when left out. */
  canvas?: string | undefined;
  chip?: string | undefined;
  success?: string | undefined;
  warning?: string | undefined;
  error?: string | undefined;
  info?: string | undefined;
}>;

const NEUTRAL_CANVAS = { light: T3_CODE_LIGHT_THEME_COLORS.canvas, dark: "#181818" } as const;

export function buildMineThemeColors(seed: MineThemeSeed, appearance: ThemeAppearance): ThemeColors {
  const dark = appearance === "dark";
  const base = dark ? T3_CODE_DARK_THEME_COLORS : T3_CODE_LIGHT_THEME_COLORS;
  const canvas = seed.canvas ?? NEUTRAL_CANVAS[appearance];
  const shell = seed.rail;
  const chip = seed.chip ?? mix(dark ? "#ffffff" : "#000000", 0.07, shell);
  const status = {
    success: seed.success ?? (dark ? "#94c9b1" : "#3f7a52"),
    warning: seed.warning ?? base.warningForeground,
    error: seed.error ?? base.errorForeground,
    info: seed.info ?? (dark ? "#93c1cc" : "#4f7c88"),
  };
  const text = dark ? "#ececec" : base.text;
  const textMuted = dark ? "#a0a0a0" : base.textMuted;
  const list = dark ? darkList(shell) : mix(shell, 0.22, canvas);
  const onAccent = isDarkColor(seed.accent) ? "#ffffff" : shell;
  const darkRail = isDarkColor(shell);
  const railInk = !dark && darkRail ? mix("#ffffff", 0.62, shell) : undefined;
  const line = (amount: number) => mix("#ffffff", amount, canvas);

  return {
    ...base,
    canvas,
    chrome: canvas,
    toolbar: canvas,
    toolbarForeground: text,
    toolbarControl: mix(seed.accent, dark ? 0.16 : 0.08, canvas),
    toolbarControlForeground: text,
    toolbarControlHover: mix(seed.accent, dark ? 0.26 : 0.14, canvas),
    text,
    textMuted,
    mutedForeground: textMuted,
    placeholder: textMuted,
    secondaryLabel: textMuted,
    iconMuted: textMuted,
    focus: seed.accent,
    accent: seed.accent,
    accentForeground: onAccent,
    messageAction: seed.accent,
    messageActionForeground: onAccent,
    messageActionHover: mix(onAccent, 0.1, seed.accent),
    error: status.error,
    errorForeground: status.error,
    warning: status.warning,
    warningForeground: status.warning,
    success: status.success,
    info: status.info,
    sidebar: list,
    sidebarForeground: text,
    sidebarMutedForeground: textMuted,
    sidebarRowHover: mix(text, 0.06, list),
    sidebarRowActive: dark ? mix(text, 0.13, list) : canvas,
    sidebarRowSelected: dark ? mix(text, 0.09, list) : mix(canvas, 0.6, list),
    rail: shell,
    railControl: darkRail ? mix("#ffffff", 0.1, shell) : chip,
    ...(railInk ? { railForeground: "#ffffff", railMutedForeground: railInk } : {}),
    ...(dark
      ? {
          surface: line(0.05),
          surfaceRaised: line(0.05),
          surfaceOverlay: line(0.07),
          secondary: line(0.03),
          secondaryForeground: text,
          muted: line(0.03),
          border: line(0.08),
          input: line(0.11),
          toolbarBorder: line(0.08),
          accentSurface: mix(seed.accent, 0.26, canvas),
          accentSurfaceForeground: text,
          messageSurface: mix(seed.accent, 0.11, canvas),
          messageForeground: text,
          codeBackground: line(0.03),
          codeForeground: text,
          sidebarControlSurface: mix("#ffffff", 0.03, list),
          sidebarBorder: line(0.08),
          terminalBackground: canvas,
          terminalForeground: text,
        }
      : {}),
  };
}

export const MINE_THEMES: ReadonlyArray<ThemeDefinition> = COLOR_THEMES.map((theme) => {
  const seed = (colors: SeedColors): MineThemeSeed => ({ ...colors, rail: colors.shell });
  return {
    id: theme.id,
    label: theme.label,
    appearance: "light",
    colors: buildMineThemeColors(seed(theme.light), "light"),
    variants: { dark: buildMineThemeColors(seed(theme.dark), "dark") },
    collection: MINE_THEME_COLLECTION,
    managed: true,
    icon: `/palette-icons/${theme.id}.png`,
  };
});

/** Reads a theme's seed back from its colors (the generator keeps them as-is). */
export function mineThemeSeedOf(colors: ThemeColors, appearance: ThemeAppearance): MineThemeSeed {
  return {
    rail: colors.rail ?? DEFAULT_SEED[appearance].rail,
    accent: colors.accent,
    canvas: colors.canvas,
    chip: colors.railControl,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
    info: colors.info,
  };
}

/** The other appearance of a seed, for a theme whose other side was not picked yet. */
export function counterpartSeed(seed: MineThemeSeed, to: ThemeAppearance): MineThemeSeed {
  const rail = toOklch(color(seed.rail));
  const accent = toOklch(color(seed.accent));
  return to === "dark"
    ? {
        rail: hex({ mode: "oklch", l: Math.min(rail.l, 0.22), c: rail.c ?? 0, h: rail.h ?? 0 }),
        accent: hex({ mode: "oklch", l: Math.max(accent.l, 0.78), c: (accent.c ?? 0) * 0.7, h: accent.h ?? 0 }),
      }
    : {
        rail: hex({ mode: "oklch", l: Math.max(rail.l, 0.92), c: (rail.c ?? 0) * 0.6, h: rail.h ?? 0 }),
        accent: hex({ mode: "oklch", l: Math.min(accent.l, 0.45), c: accent.c ?? 0, h: accent.h ?? 0 }),
      };
}

const paper = COLOR_THEMES[0];
const DEFAULT_SEED: Record<ThemeAppearance, MineThemeSeed> = {
  light: { rail: paper.light.shell, accent: paper.light.accent },
  dark: { rail: paper.dark.shell, accent: paper.dark.accent },
};

/** A new theme starts from Paper's rail and accent on a neutral chat area. */
export function defaultMineThemeColors(appearance: ThemeAppearance): ThemeColors {
  return buildMineThemeColors(DEFAULT_SEED[appearance], appearance);
}

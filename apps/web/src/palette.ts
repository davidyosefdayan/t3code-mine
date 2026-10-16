import { useSyncExternalStore } from "react";

// Color themes (personal build). A theme is one color family in a light and a
// dark version; Light / Dark / System picks which one shows. Every color used
// for a theme lives here: the stylesheet only holds rules shared by all themes,
// and this module generates each theme's variables, so previews, the picker,
// and the app always agree.

export interface ThemeColors {
  /** Frame around the app: the rail and the margin around the panel. */
  readonly shell: string;
  /** Soft filled surface for the search bar and pinned tiles. */
  readonly chip: string;
  /** Primary actions: send button, focus ring, button tints. */
  readonly accent: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly info: string;
}

export interface ColorTheme {
  readonly id: string;
  readonly label: string;
  readonly light: ThemeColors;
  readonly dark: ThemeColors;
}

// Light-panel status hues for the deep themes, whose shell stays dark.
const DEEP_LIGHT_STATUS = {
  success: "#3f7a52",
  warning: "#946a1e",
  error: "#a84a4a",
  info: "#5a5fa8",
} as const;

function deepTheme(
  id: string,
  label: string,
  shell: string,
  accent: string,
  status: Pick<ThemeColors, "success" | "warning" | "error" | "info">,
): ColorTheme {
  const colors = { shell, chip: "rgb(255 255 255 / 0.1)", accent };
  return {
    id,
    label,
    light: { ...colors, ...DEEP_LIGHT_STATUS },
    dark: { ...colors, ...status },
  };
}

export const COLOR_THEMES = [
  {
    id: "paper",
    label: "Paper",
    light: {
      shell: "#efe9df",
      chip: "#e2dacb",
      accent: "#34302b",
      success: "#5f8a58",
      warning: "#a07a26",
      error: "#b0574c",
      info: "#7d6bb3",
    },
    dark: {
      shell: "#1c1b19",
      chip: "#2a2825",
      accent: "#ece6dc",
      success: "#9cc493",
      warning: "#e2c27a",
      error: "#eb9d90",
      info: "#b3a5e6",
    },
  },
  {
    id: "lotus",
    label: "Lotus",
    light: {
      shell: "#f4e3e9",
      chip: "#e9d0da",
      accent: "#14625f",
      success: "#2f7d72",
      warning: "#a5702a",
      error: "#b0476a",
      info: "#8f5b7f",
    },
    dark: {
      shell: "#1f181c",
      chip: "#2e2329",
      accent: "#7fc7bf",
      success: "#86cdbf",
      warning: "#e3b77a",
      error: "#ee9bb4",
      info: "#cf9fc3",
    },
  },
  {
    id: "storm",
    label: "Storm",
    light: {
      shell: "#e2ebe9",
      chip: "#cfdcd9",
      accent: "#3d6a65",
      success: "#3f7a66",
      warning: "#8a7530",
      error: "#a4534a",
      info: "#4f7c88",
    },
    dark: {
      shell: "#141b1c",
      chip: "#212a2b",
      accent: "#8fbcb4",
      success: "#94c9b1",
      warning: "#d9c27e",
      error: "#e8a097",
      info: "#93c1cc",
    },
  },
  {
    id: "crocus",
    label: "Crocus",
    light: {
      shell: "#e8e5f5",
      chip: "#d8d2ee",
      accent: "#56499b",
      success: "#4a7d5a",
      warning: "#9a7426",
      error: "#a8506a",
      info: "#6a62b0",
    },
    dark: {
      shell: "#18172a",
      chip: "#25223a",
      accent: "#b3a9ec",
      success: "#9ccaa6",
      warning: "#e0c07c",
      error: "#eaa0b4",
      info: "#b8b0f0",
    },
  },
  {
    id: "peony",
    label: "Peony",
    light: {
      shell: "#f7e7e2",
      chip: "#eed4cd",
      accent: "#6c7254",
      success: "#5f7040",
      warning: "#a66a2c",
      error: "#b5534e",
      info: "#b06f7a",
    },
    dark: {
      shell: "#1f1918",
      chip: "#2e2422",
      accent: "#c9cdb0",
      success: "#b7c79a",
      warning: "#e8bd85",
      error: "#f0a39c",
      info: "#e6a9b3",
    },
  },
  {
    id: "succulent",
    label: "Succulent",
    light: {
      shell: "#dfeae2",
      chip: "#cddfd2",
      accent: "#1f4d3f",
      success: "#2f6f4d",
      warning: "#8f7428",
      error: "#a5524a",
      info: "#3f7079",
    },
    dark: {
      shell: "#121a16",
      chip: "#1e2923",
      accent: "#8ccab0",
      success: "#93cfa9",
      warning: "#dbc27c",
      error: "#e8a097",
      info: "#93c4cc",
    },
  },
  {
    id: "meadow",
    label: "Meadow",
    light: {
      shell: "#f8eed0",
      chip: "#eedfb7",
      accent: "#8a5571",
      success: "#5c7034",
      warning: "#a3711a",
      error: "#b0524f",
      info: "#a86a8a",
    },
    dark: {
      shell: "#1e1a12",
      chip: "#2c261a",
      accent: "#e1b1c9",
      success: "#b5cb8e",
      warning: "#ecc77a",
      error: "#eda29e",
      info: "#e2a8c6",
    },
  },
  deepTheme("blueberry", "Blueberry", "#1e3150", "#2f5c94", {
    success: "#9fd6b0",
    warning: "#f2cf86",
    error: "#f4a7a2",
    info: "#b9c8f2",
  }),
  deepTheme("forest", "Forest", "#173a2f", "#235c49", {
    success: "#a8dcb8",
    warning: "#ecd08c",
    error: "#f2aaa2",
    info: "#a9d3dc",
  }),
  deepTheme("rosewood", "Rosewood", "#6a3450", "#8c4467", {
    success: "#b9e0c2",
    warning: "#f6d79a",
    error: "#ffc1c6",
    info: "#f0c4dd",
  }),
  deepTheme("plum", "Plum", "#382356", "#5b3d8c", {
    success: "#acdcb8",
    warning: "#f1d18e",
    error: "#f6abb6",
    info: "#d4c4f6",
  }),
  deepTheme("deepteal", "Deep Teal", "#0f4746", "#14625f", {
    success: "#a6e0cf",
    warning: "#f0d08c",
    error: "#f5abae",
    info: "#a9dbe0",
  }),
] as const satisfies ReadonlyArray<ColorTheme>;

export type PaletteId = (typeof COLOR_THEMES)[number]["id"];

// ---------------------------------------------------------------------------
// Generated styles

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return 1;
  const channel = (offset: number) => {
    const value = Number.parseInt(match[1]!.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Dark colors need light text on top. */
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.18;
}

// Light-on-dark overrides for a deep frame: text, icons, and row washes.
const ON_DARK_FRAME = `
  --contrast-sidebar-foreground: #ffffff;
  --contrast-sidebar-muted-foreground: rgb(255 255 255 / 0.62);
  --contrast-foreground: #ffffff;
  --contrast-muted-foreground: rgb(255 255 255 / 0.62);
  --contrast-icon-muted: rgb(255 255 255 / 0.62);
  --sidebar-icon-color: rgb(255 255 255 / 0.62);
  --foreground: #ffffff;
  --muted-foreground: rgb(255 255 255 / 0.62);
  --pal-row-hover: rgb(255 255 255 / 0.08);
  --pal-row-active: rgb(255 255 255 / 0.17);`;

function themeRules(theme: ColorTheme): string {
  // One step more specific than the stock theme rule (html[data-theme-id]
  // :not(...)), so themes win regardless of stylesheet load order.
  const root = (dark: boolean) =>
    `html:root${dark ? ".dark" : ""}[data-palette="${theme.id}"]:not([data-palette=""])`;
  return (["light", "dark"] as const)
    .map((mode) => {
      const colors = theme[mode];
      const selector = root(mode === "dark");
      const onAccent = isDarkColor(colors.accent) ? "#ffffff" : colors.shell;
      const base = `${selector} {
  --pal-shell: ${colors.shell};
  --pal-chip: ${colors.chip};
  --primary: ${colors.accent};
  --primary-foreground: ${onAccent};
  --message-action: ${colors.accent};
  --message-action-foreground: ${onAccent};
  --ring: ${colors.accent};
  --success: ${colors.success};
  --success-foreground: ${colors.success};
  --warning: ${colors.warning};
  --warning-foreground: ${colors.warning};
  --error: ${colors.error};
  --error-foreground: ${colors.error};
  --info: ${colors.info};
  --info-foreground: ${colors.info};
}`;
      // A dark frame in light mode needs light-on-dark rail controls.
      return mode === "light" && isDarkColor(colors.shell)
        ? `${base}\n${selector} [data-app-rail],\n${selector} [data-app-topbar] {${ON_DARK_FRAME}\n}`
        : base;
    })
    .join("\n");
}

function installThemeStyles(): void {
  if (typeof document === "undefined" || document.getElementById("color-themes")) return;
  const style = document.createElement("style");
  style.id = "color-themes";
  style.textContent = COLOR_THEMES.map(themeRules).join("\n");
  document.head.append(style);
}

// ---------------------------------------------------------------------------
// Selection

const STORAGE_KEY = "t3code:palette";
const DEFAULT_PALETTE: PaletteId = "paper";
const listeners = new Set<() => void>();

function readPalette(): PaletteId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const theme = COLOR_THEMES.find((candidate) => candidate.id === stored);
    if (theme) return theme.id;
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  return DEFAULT_PALETTE;
}

function syncDockIcon(id: PaletteId): void {
  void window.desktopBridge?.setDockPaletteIcon?.(id).catch(() => {});
}

export function applyStoredPalette(): void {
  installThemeStyles();
  const palette = readPalette();
  document.documentElement.dataset.palette = palette;
  syncDockIcon(palette);
}

export function setPalette(id: PaletteId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Still apply it for this session.
  }
  document.documentElement.dataset.palette = id;
  syncDockIcon(id);
  for (const listener of listeners) listener();
}

export function usePalette(): PaletteId {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readPalette,
    () => DEFAULT_PALETTE,
  );
}
